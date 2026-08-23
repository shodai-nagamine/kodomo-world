/**
 * modeler.js — KODOMO WORLD 画像解析モジュール（背景抜き＋輪郭抽出）
 *
 * classic script（<script src> で読み込む。import/export は使わない）。
 * ブラウザでは window.KWModel.analyze(blob, opts) を主API として公開する。
 * AI・外部APIは一切使わず、素の Canvas 2D とアルゴリズムだけで完結する。
 *
 * 内部の「マスク→輪郭抽出→簡略化」パイプラインは DOM に依存しない純粋関数として
 * 切り出してあり、ファイル末尾の module.exports ガードで Node からも呼び出せる
 * （ブラウザでは無害。window.KWModel が主APIであることに変わりはない）。
 */
(function () {
  'use strict';

  // =====================================================================
  // 色空間・色差
  // =====================================================================

  function srgbChannelToLinear(c) {
    var cs = c / 255;
    return cs <= 0.04045 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
  }

  // sRGB(0-255) -> CIE Lab (D65白色点)。簡易Lab変換。
  function rgbToLab(r, g, b) {
    var rl = srgbChannelToLinear(r);
    var gl = srgbChannelToLinear(g);
    var bl = srgbChannelToLinear(b);
    var x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
    var y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750;
    var z = rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041;
    x /= 0.95047; y /= 1.0; z /= 1.08883;
    var f = function (t) { return t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116); };
    var fx = f(x), fy = f(y), fz = f(z);
    var L = 116 * fy - 16;
    var a = 500 * (fx - fy);
    var bb = 200 * (fy - fz);
    return [L, a, bb];
  }

  // 2つのRGB色の知覚色差を 0..1 程度のスケールで返す（Lab距離/100）。
  // 選定理由: 単純なRGBユークリッド距離だと「明度差」と「色相差」が均等に混ざり、
  // 白い紙の上の影（明度は下がるが色相はほぼ同じ）を誤って前景（＝抜けていない）
  // と判定したり、逆に薄い色の絵を背景として抜きすぎたりしやすい。知覚的に均等な
  // Lab空間でのユークリッド距離（CIE76）を使うことで、明度差にも色相差にも適度に
  // 反応する指標にした。
  function colorDistance(rgb1, rgb2) {
    var lab1 = rgbToLab(rgb1[0], rgb1[1], rgb1[2]);
    var lab2 = rgbToLab(rgb2[0], rgb2[1], rgb2[2]);
    var dl = lab1[0] - lab2[0], da = lab1[1] - lab2[1], db = lab1[2] - lab2[2];
    return Math.sqrt(dl * dl + da * da + db * db) / 100;
  }

  // =====================================================================
  // 背景色推定（外周帯のヒストグラム最頻色）
  // =====================================================================

  // 画像外周 bandFrac (既定2%) の帯から、色を5bit/chに量子化したヒストグラムを作り
  // 最頻ビンの平均色を返す。単純平均ではなく最頻ビンを使うことで、白い紙＋影や
  // ノイズなど少数派の色に引っ張られにくい（中央値相当のロバスト性）。
  function estimateBackgroundColor(data, width, height, bandFrac) {
    bandFrac = bandFrac == null ? 0.02 : bandFrac;
    var band = Math.max(2, Math.round(Math.min(width, height) * bandFrac));
    var BITS = 5;
    var SHIFT = 8 - BITS;
    var BUCKETS = 1 << (BITS * 3);
    var counts = new Uint32Array(BUCKETS);
    var sumR = new Float64Array(BUCKETS);
    var sumG = new Float64Array(BUCKETS);
    var sumB = new Float64Array(BUCKETS);

    function sample(x, y) {
      var i = (y * width + x) * 4;
      var r = data[i], g = data[i + 1], b = data[i + 2];
      var key = ((r >> SHIFT) << (BITS * 2)) | ((g >> SHIFT) << BITS) | (b >> SHIFT);
      counts[key]++;
      sumR[key] += r; sumG[key] += g; sumB[key] += b;
    }

    for (var y = 0; y < height; y++) {
      if (y < band || y >= height - band) {
        for (var x = 0; x < width; x++) sample(x, y);
      } else {
        for (var x2 = 0; x2 < band; x2++) sample(x2, y);
        for (var x3 = width - band; x3 < width; x3++) sample(x3, y);
      }
    }

    var bestKey = 0, bestCount = -1;
    for (var k = 0; k < BUCKETS; k++) {
      if (counts[k] > bestCount) { bestCount = counts[k]; bestKey = k; }
    }
    if (bestCount <= 0) return [255, 255, 255];
    return [
      Math.round(sumR[bestKey] / bestCount),
      Math.round(sumG[bestKey] / bestCount),
      Math.round(sumB[bestKey] / bestCount)
    ];
  }

  // =====================================================================
  // 背景のフラッドフィル（外周から連結した領域だけを背景とみなす）
  // 明示的なキュー(Int32Array)によるBFS。再帰は使わない（スタックオーバーフロー回避）。
  // =====================================================================

  function floodFillBackground(data, width, height, bgColor, tolerance) {
    var total = width * height;
    var bgLab = rgbToLab(bgColor[0], bgColor[1], bgColor[2]);
    var background = new Uint8Array(total); // 1 = 背景
    var checked = new Uint8Array(total);    // 1 = 距離計算済み（再計算を避ける）
    var queue = new Int32Array(total);
    var qHead = 0, qTail = 0;

    function pixelDistance(i) {
      var o = i * 4;
      var lab = rgbToLab(data[o], data[o + 1], data[o + 2]);
      var dl = lab[0] - bgLab[0], da = lab[1] - bgLab[1], db = lab[2] - bgLab[2];
      return Math.sqrt(dl * dl + da * da + db * db) / 100;
    }

    function tryMark(x, y) {
      var i = y * width + x;
      if (checked[i]) return;
      checked[i] = 1;
      if (pixelDistance(i) <= tolerance) {
        background[i] = 1;
        queue[qTail++] = i;
      }
    }

    for (var x = 0; x < width; x++) {
      tryMark(x, 0);
      tryMark(x, height - 1);
    }
    for (var y = 0; y < height; y++) {
      tryMark(0, y);
      tryMark(width - 1, y);
    }

    while (qHead < qTail) {
      var i = queue[qHead++];
      var cx = i % width;
      var cy = (i / width) | 0;
      if (cx > 0) tryMark(cx - 1, cy);
      if (cx < width - 1) tryMark(cx + 1, cy);
      if (cy > 0) tryMark(cx, cy - 1);
      if (cy < height - 1) tryMark(cx, cy + 1);
    }

    var foreground = new Uint8Array(total);
    for (var j = 0; j < total; j++) foreground[j] = background[j] ? 0 : 1;
    return foreground;
  }

  // =====================================================================
  // 連結成分ラベリング（8連結）。ラスタスキャン順で見つかる各成分の最初の画素は
  // 「最も上・その中で最も左」の画素になるため、そのままモース近傍追跡の開始点に使える。
  // =====================================================================

  function labelComponents(mask, width, height, connectivity) {
    connectivity = connectivity || 8;
    var total = width * height;
    var labels = new Int32Array(total).fill(-1);
    var areas = [];
    var starts = [];
    var queue = new Int32Array(total);
    var neighbors4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    var neighbors8 = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
    var neigh = connectivity === 4 ? neighbors4 : neighbors8;
    var nextLabel = 0;

    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        var idx = y * width + x;
        if (mask[idx] !== 1 || labels[idx] !== -1) continue;
        var label = nextLabel++;
        starts.push([x, y]);
        var qHead = 0, qTail = 0;
        labels[idx] = label;
        queue[qTail++] = idx;
        var area = 0;
        while (qHead < qTail) {
          var cur = queue[qHead++];
          area++;
          var cx = cur % width, cy = (cur / width) | 0;
          for (var n = 0; n < neigh.length; n++) {
            var nx = cx + neigh[n][0], ny = cy + neigh[n][1];
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            var nidx = ny * width + nx;
            if (mask[nidx] === 1 && labels[nidx] === -1) {
              labels[nidx] = label;
              queue[qTail++] = nidx;
            }
          }
        }
        areas.push(area);
      }
    }
    return { labels: labels, numLabels: nextLabel, areas: areas, starts: starts };
  }

  // 全体の minAreaFrac 未満の孤立ブロブを除去する。
  function removeSmallBlobs(mask, width, height, minAreaFrac) {
    var total = width * height;
    var minArea = Math.max(1, Math.round(total * minAreaFrac));
    var lc = labelComponents(mask, width, height, 8);
    var keep = new Uint8Array(lc.numLabels);
    for (var l = 0; l < lc.numLabels; l++) keep[l] = lc.areas[l] >= minArea ? 1 : 0;
    var out = new Uint8Array(total);
    for (var i = 0; i < total; i++) {
      var lab = lc.labels[i];
      out[i] = (lab >= 0 && keep[lab]) ? 1 : 0;
    }
    return out;
  }

  // 3x3(既定radius=1)のボックスブラー。マスクの輪郭を1px程度なめらかにし、
  // 切り抜きのギザギザ・フリンジを減らすために使う。戻り値は 0..1 の連続値。
  function boxBlurMask(mask, width, height, radius) {
    radius = radius == null ? 1 : radius;
    var total = width * height;
    var out = new Float32Array(total);
    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        var sum = 0, count = 0;
        for (var dy = -radius; dy <= radius; dy++) {
          var yy = y + dy;
          if (yy < 0 || yy >= height) continue;
          for (var dx = -radius; dx <= radius; dx++) {
            var xx = x + dx;
            if (xx < 0 || xx >= width) continue;
            sum += mask[yy * width + xx];
            count++;
          }
        }
        out[y * width + x] = sum / count;
      }
    }
    return out;
  }

  // =====================================================================
  // 輪郭追跡（Moore-Neighbor tracing、Jacob's stopping criterion）
  // marching squares の代わりに、前景マスクの外周画素を直接たどるアルゴリズムを採用。
  // 実装がシンプルで、閉じた単純多角形を得やすい（自己交差はスムージングにより低減）。
  // =====================================================================

  function traceBoundary(binMask, width, height, sx, sy) {
    var dirs = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];

    function isFg(x, y) {
      if (x < 0 || x >= width || y < 0 || y >= height) return false;
      return binMask[y * width + x] === 1;
    }

    var hasNeighbor = false;
    for (var d = 0; d < dirs.length; d++) {
      if (isFg(sx + dirs[d][0], sy + dirs[d][1])) { hasNeighbor = true; break; }
    }
    if (!hasNeighbor) {
      // 孤立画素: 画素を囲む小さな四角形として返す
      return [[sx - 0.5, sy - 0.5], [sx + 0.5, sy - 0.5], [sx + 0.5, sy + 0.5], [sx - 0.5, sy + 0.5]];
    }

    var boundary = [[sx, sy]];
    var curX = sx, curY = sy;
    var backtrackDir = 0; // ラスタスキャンで見つけた開始点の西側は必ず背景
    var firstNextX = null, firstNextY = null;
    var maxSteps = width * height * 8 + 16;

    for (var steps = 0; steps < maxSteps; steps++) {
      var foundDir = -1, nx = 0, ny = 0;
      for (var k = 1; k <= 8; k++) {
        var dIdx = (backtrackDir + k) % 8;
        var tx = curX + dirs[dIdx][0], ty = curY + dirs[dIdx][1];
        if (isFg(tx, ty)) { foundDir = dIdx; nx = tx; ny = ty; break; }
      }
      if (foundDir === -1) break; // 行き止まり（実質孤立）

      if (firstNextX === null) {
        firstNextX = nx; firstNextY = ny;
      } else if (curX === sx && curY === sy && nx === firstNextX && ny === firstNextY) {
        break; // 最初の遷移と同じ状態に戻った＝一周完了
      }

      boundary.push([nx, ny]);
      backtrackDir = (foundDir + 4) % 8;
      curX = nx; curY = ny;
    }

    return boundary;
  }

  // =====================================================================
  // 多角形の向き・面積
  // =====================================================================

  // シューレース公式による符号付き面積。画像座標系(x右, y下)上で正の値になる
  // 向きを本モジュールの正準の「CCW」として扱う（すべての輪郭でこの符号に揃える）。
  function polygonSignedArea(points) {
    var sum = 0;
    var n = points.length;
    for (var i = 0; i < n; i++) {
      var p1 = points[i], p2 = points[(i + 1) % n];
      sum += p1[0] * p2[1] - p2[0] * p1[1];
    }
    return sum / 2;
  }

  function ensureCCW(points) {
    var area = polygonSignedArea(points);
    if (area < 0) {
      var rev = points.slice().reverse();
      return rev;
    }
    return points.slice();
  }

  // =====================================================================
  // Ramer–Douglas–Peucker 簡略化（再帰を避け、明示的スタックで実装）
  // =====================================================================

  function perpendicularDistance(pt, lineStart, lineEnd) {
    var x = pt[0], y = pt[1], x1 = lineStart[0], y1 = lineStart[1], x2 = lineEnd[0], y2 = lineEnd[1];
    var dx = x2 - x1, dy = y2 - y1;
    var lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(x - x1, y - y1);
    var t = ((x - x1) * dx + (y - y1) * dy) / lenSq;
    var projX = x1 + t * dx, projY = y1 + t * dy;
    return Math.hypot(x - projX, y - projY);
  }

  function simplifyRDP(points, epsilon) {
    var n = points.length;
    if (n < 3) return points.slice();
    var keep = new Uint8Array(n);
    keep[0] = 1; keep[n - 1] = 1;
    var stack = [[0, n - 1]];
    while (stack.length) {
      var range = stack.pop();
      var start = range[0], end = range[1];
      if (end <= start + 1) continue;
      var maxDist = -1, maxIdx = -1;
      for (var i = start + 1; i < end; i++) {
        var dist = perpendicularDistance(points[i], points[start], points[end]);
        if (dist > maxDist) { maxDist = dist; maxIdx = i; }
      }
      if (maxDist > epsilon) {
        keep[maxIdx] = 1;
        stack.push([start, maxIdx]);
        stack.push([maxIdx, end]);
      }
    }
    var result = [];
    for (var j = 0; j < n; j++) if (keep[j]) result.push(points[j]);
    return result;
  }

  // epsilon を段階的に大きくして maxPoints 以下になるまで簡略化する。
  // 最終手段として一様間引きで確実に上限を守る。
  function simplifyToMaxPoints(points, maxPoints, baseEps) {
    // 上限以下でも必ず一度は間引く。そうしないと直線の辺が画素刻みのまま残り、
    // 押し出したときに無駄な頂点だらけの立体になる（正方形が150頂点になっていた）
    var eps = baseEps != null ? baseEps : 0.8;
    var result = simplifyRDP(points, eps);
    if (result.length <= maxPoints) return result;
    for (var i = 0; i < 30; i++) {
      eps *= 1.5;
      result = simplifyRDP(points, eps);
      if (result.length <= maxPoints) return result;
    }
    if (result.length > maxPoints) {
      var step = result.length / maxPoints;
      var out = [];
      for (var k = 0; k < maxPoints; k++) {
        out.push(result[Math.floor(k * step)]);
      }
      return out;
    }
    return result;
  }

  // =====================================================================
  // マスク → 輪郭群（正規化座標・面積の大きい順・簡略化済み）
  // =====================================================================

  function extractContours(mask, width, height, opts) {
    opts = opts || {};
    var minBlobAreaFrac = opts.minBlobAreaFrac != null ? opts.minBlobAreaFrac : 0.0005; // 0.05%
    var minContourAreaFrac = opts.minContourAreaFrac != null ? opts.minContourAreaFrac : 0.004; // 0.4%
    var maxPoints = opts.maxPoints != null ? opts.maxPoints : 160;
    var smooth = opts.smooth !== false;

    var total = width * height;

    // (a) 孤立した微小ブロブを除去
    var working = removeSmallBlobs(mask, width, height, minBlobAreaFrac);

    // (b) 輪郭を1px程度なめらかにする（ボックスブラー→閾値0.5で二値化）
    var binaryForTrace = working;
    if (smooth) {
      var blurred = boxBlurMask(working, width, height, 1);
      binaryForTrace = new Uint8Array(total);
      for (var i = 0; i < total; i++) binaryForTrace[i] = blurred[i] >= 0.5 ? 1 : 0;
    }

    var lc = labelComponents(binaryForTrace, width, height, 8);
    var minContourArea = total * minContourAreaFrac;
    var components = [];
    for (var l = 0; l < lc.numLabels; l++) {
      if (lc.areas[l] >= minContourArea) {
        components.push({ label: l, area: lc.areas[l], start: lc.starts[l] });
      }
    }
    components.sort(function (a, b) { return b.area - a.area; });

    var contours = [];
    for (var c = 0; c < components.length; c++) {
      var comp = components[c];
      var sx = comp.start[0], sy = comp.start[1];
      var boundary = traceBoundary(binaryForTrace, width, height, sx, sy);
      if (boundary.length < 3) continue;
      boundary = simplifyToMaxPoints(boundary, maxPoints, opts.baseEps);
      if (boundary.length < 3) continue;
      boundary = ensureCCW(boundary);
      if (boundary.length > 1) {
        var first = boundary[0], last = boundary[boundary.length - 1];
        if (first[0] === last[0] && first[1] === last[1]) boundary = boundary.slice(0, -1);
      }
      if (boundary.length < 3) continue;
      var normalized = boundary.map(function (p) { return [p[0] / width, p[1] / height]; });
      contours.push({ points: normalized, area: comp.area / total });
    }

    contours.sort(function (a, b) { return b.area - a.area; });
    return contours.map(function (c2) { return c2.points; });
  }

  // =====================================================================
  // ブラウザ用グルーコード（Canvas 2D / createImageBitmap を使う）
  // =====================================================================

  function fullRectContour() {
    return [[[0, 0], [1, 0], [1, 1], [0, 1]]];
  }

  function canvasToPngBlob(cv) {
    return new Promise(function (resolve, reject) {
      cv.toBlob(function (b) {
        if (b) resolve(b); else reject(new Error('cutout画像の生成に失敗しました'));
      }, 'image/png');
    });
  }

  async function analyze(blob, opts) {
    opts = opts || {};
    var tolerance = opts.tolerance != null ? opts.tolerance : 0.16;
    var maxSize = opts.maxSize != null ? opts.maxSize : 900;
    var maxPoints = opts.maxPoints != null ? opts.maxPoints : 160;
    var removeBackground = opts.removeBackground !== false;

    // 1. 縮小（EXIF回転を反映してから長辺 maxSize 以下に）
    var bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    var srcW = bitmap.width, srcH = bitmap.height;
    var scale = Math.min(1, maxSize / Math.max(srcW, srcH));
    var width = Math.max(1, Math.round(srcW * scale));
    var height = Math.max(1, Math.round(srcH * scale));

    var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, width, height);
    if (bitmap.close) bitmap.close();

    var imageData = ctx.getImageData(0, 0, width, height);
    var data = imageData.data;
    var total = width * height;

    if (!removeBackground) {
      var plainCutout = await canvasToPngBlob(canvas);
      return {
        cutout: plainCutout,
        width: width,
        height: height,
        contours: fullRectContour(),
        coverage: 1,
        ok: true
      };
    }

    // 2. 背景色推定
    var bgColor = estimateBackgroundColor(data, width, height, 0.02);

    // 3. フラッドフィルで背景判定
    var foregroundMask = floodFillBackground(data, width, height, bgColor, tolerance);

    var fgCount = 0;
    for (var i = 0; i < total; i++) fgCount += foregroundMask[i];
    var coverage = fgCount / total;

    // 7. 失敗検出（背景を抜けていない／抜きすぎ）→ 背景を抜かない結果にフォールバック
    if (coverage > 0.95 || coverage < 0.03) {
      var fallbackCutout = await canvasToPngBlob(canvas); // canvasはまだ元画像のまま
      return {
        cutout: fallbackCutout,
        width: width,
        height: height,
        contours: fullRectContour(),
        coverage: coverage,
        ok: false,
        reason: coverage > 0.95 ? '背景を判定できませんでした' : '前景が小さすぎます（背景を抜きすぎました）'
      };
    }

    // 4. 後処理（微小ブロブ除去）
    var cleanedMask = removeSmallBlobs(foregroundMask, width, height, 0.0005);

    // 4(b). 輪郭のなめらか化と同じブラーを alpha に流用してフリンジを軽減
    var blurredAlpha = boxBlurMask(cleanedMask, width, height, 1);

    var outData = new Uint8ClampedArray(data.length);
    for (var j = 0; j < total; j++) {
      var o = j * 4;
      var a = blurredAlpha[j];
      if (a < 0) a = 0; if (a > 1) a = 1;
      outData[o] = data[o];
      outData[o + 1] = data[o + 1];
      outData[o + 2] = data[o + 2];
      outData[o + 3] = Math.round(a * 255);
    }
    var outImageData = new ImageData(outData, width, height);
    ctx.putImageData(outImageData, 0, 0);
    var cutout = await canvasToPngBlob(canvas);

    // 5-6. 輪郭抽出・簡略化
    var contours = extractContours(cleanedMask, width, height, { maxPoints: maxPoints });

    if (contours.length === 0) {
      var fallbackCanvas = document.createElement('canvas');
      fallbackCanvas.width = width; fallbackCanvas.height = height;
      var fctx = fallbackCanvas.getContext('2d');
      fctx.putImageData(imageData, 0, 0); // 元の(背景抜き前)画像
      var fallbackBlob = await canvasToPngBlob(fallbackCanvas);
      return {
        cutout: fallbackBlob,
        width: width,
        height: height,
        contours: fullRectContour(),
        coverage: coverage,
        ok: false,
        reason: '輪郭を抽出できませんでした'
      };
    }

    return {
      cutout: cutout,
      width: width,
      height: height,
      contours: contours,
      coverage: coverage,
      ok: true
    };
  }

  var KWModel = { analyze: analyze };

  if (typeof window !== 'undefined') {
    window.KWModel = KWModel;
  }

  // Node からのテスト用（ブラウザでは無害。window.KWModel が主APIであることは変わらない）
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      rgbToLab: rgbToLab,
      colorDistance: colorDistance,
      estimateBackgroundColor: estimateBackgroundColor,
      floodFillBackground: floodFillBackground,
      labelComponents: labelComponents,
      removeSmallBlobs: removeSmallBlobs,
      boxBlurMask: boxBlurMask,
      traceBoundary: traceBoundary,
      polygonSignedArea: polygonSignedArea,
      ensureCCW: ensureCCW,
      simplifyRDP: simplifyRDP,
      simplifyToMaxPoints: simplifyToMaxPoints,
      extractContours: extractContours,
      KWModel: KWModel
    };
  }
})();
