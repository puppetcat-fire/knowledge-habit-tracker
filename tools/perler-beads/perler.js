// 图片转拼豆图纸：纯前端，图片只在浏览器里处理。
(function () {
  // 豆子调色板（常见拼豆基础色，hex）
  const PALETTE = [
    ["黑", "#1a1a1a"], ["白", "#f5f5f5"], ["红", "#d32f2f"], ["橙", "#f57c00"],
    ["黄", "#fbc02d"], ["浅绿", "#8bc34a"], ["绿", "#388e3c"], ["浅蓝", "#4fc3f7"],
    ["蓝", "#1976d2"], ["紫", "#7b1fa2"], ["粉", "#f48fb1"], ["棕", "#795548"],
    ["灰", "#9e9e9e"], ["深灰", "#616161"], ["米黄", "#ffe0b2"], ["天蓝", "#81d4fa"],
    ["青", "#26c6da"], ["深绿", "#2e7d32"], ["玫红", "#c2185b"], ["杏色", "#ffcc80"]
  ];

  function hexToRgb(hex) {
    let h = hex.replace("#", "");
    if (h.length === 3) h = h.split("").map((x) => x + x).join("");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function nearest(hex) {
    const c = hexToRgb(hex);
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < PALETTE.length; i++) {
      const p = hexToRgb(PALETTE[i][1]);
      const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  function render(grid, count, gw, gh) {
    const g = document.getElementById("grid");
    g.style.gridTemplateColumns = "repeat(" + gw + ", 1fr)";
    g.style.width = "min(560px, 100%)";
    g.style.aspectRatio = gw + " / " + gh;
    g.innerHTML = "";
    grid.flat().forEach((idx) => {
      const c = document.createElement("div");
      c.className = "cell";
      c.style.background = PALETTE[idx][1];
      g.appendChild(c);
    });

    const lg = document.getElementById("legend");
    lg.innerHTML = "";
    Object.keys(count)
      .sort((a, b) => count[b] - count[a])
      .forEach((idx) => {
        const d = document.createElement("div");
        d.className = "item";
        d.innerHTML =
          '<span class="sw" style="background:' + PALETTE[idx][1] + '"></span>' +
          PALETTE[idx][0] + " ×" + count[idx];
        lg.appendChild(d);
      });

    document.getElementById("out").hidden = false;
    window._grid = grid;
  }

  document.getElementById("go").addEventListener("click", () => {
    const f = document.getElementById("file").files[0];
    if (!f) {
      alert("请先选择图片");
      return;
    }
    const gw = +document.getElementById("gw").value;
    const gh = +document.getElementById("gh").value;
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement("canvas");
      cv.width = gw;
      cv.height = gh;
      const ctx = cv.getContext("2d");
      ctx.drawImage(img, 0, 0, gw, gh);
      const data = ctx.getImageData(0, 0, gw, gh).data;

      // 每个像素匹配最近的一种豆子颜色
      const grid = [];
      const count = {};
      for (let y = 0; y < gh; y++) {
        const row = [];
        for (let x = 0; x < gw; x++) {
          const i = (y * gw + x) * 4;
          const hex =
            "#" +
            [data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join("");
          const idx = nearest(hex);
          row.push(idx);
          count[idx] = (count[idx] || 0) + 1;
        }
        grid.push(row);
      }
      render(grid, count, gw, gh);
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(f);
  });

  document.getElementById("share").addEventListener("click", () => {
    if (!window._grid) return;
    localStorage.setItem("pending_grid", JSON.stringify(window._grid));
    location.href = "/tools/beads-community.html";
  });
})();
