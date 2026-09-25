// 由 scripts/build-seed-bundle.js 从 seed-trees/*.json 生成，请勿手改。
(function (root) {
  root.FOREST_SEED_TREES = {
    "k9-math": {
      "format": "forest-tree/v1",
      "tree": {
        "id": "k9-math",
        "name": "K9 数学",
        "domain": "k9-math",
        "note": "种子树：按自然脉络组织（数→运算→代数→几何），不按年级。内容对齐义务教育课标知识点，组织按逻辑推演。version 用 seed 占位（正式版替换为内容哈希）。"
      },
      "nodes": [
        {
          "id": "natural-numbers",
          "title": "自然数",
          "goal": "读写、比较自然数，理解 0 与计数",
          "estMinutes": 10,
          "verifyHint": "解释自然数是什么，举 3 个例子并从小到大排序",
          "ownership": "group",
          "ownerId": null,
          "version": "seed-1",
          "versions": [
            "seed-1"
          ]
        },
        {
          "id": "integers",
          "title": "整数",
          "goal": "理解负数，会整数的加减乘除与大小比较",
          "estMinutes": 12,
          "verifyHint": "在数轴上标出 -3、0、5，解释负数为什么存在",
          "ownership": "group",
          "ownerId": null,
          "version": "seed-1",
          "versions": [
            "seed-1"
          ]
        },
        {
          "id": "rational-numbers",
          "title": "有理数",
          "goal": "理解分数与小数是有理数，能进行有理数四则运算",
          "estMinutes": 15,
          "verifyHint": "算一道分数混合运算，并解释每一步的法则",
          "ownership": "group",
          "ownerId": null,
          "version": "seed-1",
          "versions": [
            "seed-1"
          ]
        },
        {
          "id": "real-numbers",
          "title": "实数",
          "goal": "理解无理数（√2、π），区分有理数与无理数",
          "estMinutes": 10,
          "verifyHint": "举例说明 √2 为什么不是有理数",
          "ownership": "group",
          "ownerId": null,
          "version": "seed-1",
          "versions": [
            "seed-1"
          ]
        },
        {
          "id": "add-subtract",
          "title": "加减法",
          "goal": "熟练整数与小数加减法",
          "estMinutes": 8,
          "verifyHint": "口算 5 道加减法并说明进退位",
          "ownership": "group",
          "ownerId": null,
          "version": "seed-1",
          "versions": [
            "seed-1"
          ]
        },
        {
          "id": "multiply-divide",
          "title": "乘除法",
          "goal": "熟练整数与小数乘除法",
          "estMinutes": 10,
          "verifyHint": "笔算一道两位数乘除并验算",
          "ownership": "group",
          "ownerId": null,
          "version": "seed-1",
          "versions": [
            "seed-1"
          ]
        },
        {
          "id": "mixed-operations",
          "title": "四则混合运算",
          "goal": "掌握运算顺序，正确进行四则混合运算",
          "estMinutes": 10,
          "verifyHint": "算一道带括号的四则混合，说出运算顺序",
          "ownership": "group",
          "ownerId": null,
          "version": "seed-1",
          "versions": [
            "seed-1"
          ]
        },
        {
          "id": "exponent",
          "title": "乘方",
          "goal": "理解乘方与幂，会计算幂",
          "estMinutes": 10,
          "verifyHint": "解释 2³ 的含义并口算",
          "ownership": "group",
          "ownerId": null,
          "version": "seed-1",
          "versions": [
            "seed-1"
          ]
        },
        {
          "id": "square-root",
          "title": "平方根",
          "goal": "理解平方根与开方，会求完全平方数的平方根",
          "estMinutes": 12,
          "verifyHint": "求 √49 并解释平方与开方互逆",
          "ownership": "group",
          "ownerId": null,
          "version": "seed-1",
          "versions": [
            "seed-1"
          ]
        },
        {
          "id": "algebraic-expression",
          "title": "代数式",
          "goal": "会用字母表示数，列代数式",
          "estMinutes": 10,
          "verifyHint": "把「a 的 2 倍加 3」写成代数式并求值",
          "ownership": "group",
          "ownerId": null,
          "version": "seed-1",
          "versions": [
            "seed-1"
          ]
        },
        {
          "id": "like-terms",
          "title": "合并同类项",
          "goal": "识别同类项并合并",
          "estMinutes": 10,
          "verifyHint": "合并 3a + 2b - a + 4b",
          "ownership": "group",
          "ownerId": null,
          "version": "seed-1",
          "versions": [
            "seed-1"
          ]
        },
        {
          "id": "linear-equation",
          "title": "一元一次方程",
          "goal": "会解 ax + b = c 型方程，并能列方程解应用题",
          "estMinutes": 12,
          "verifyHint": "解 3x + 5 = 20，并讲清每一步依据",
          "ownership": "group",
          "ownerId": null,
          "version": "seed-1",
          "versions": [
            "seed-1"
          ]
        },
        {
          "id": "system-linear",
          "title": "二元一次方程组",
          "goal": "会用代入法/消元法解二元一次方程组",
          "estMinutes": 15,
          "verifyHint": "解 {x+y=10, x-y=2}，解释消元思路",
          "ownership": "group",
          "ownerId": null,
          "version": "seed-1",
          "versions": [
            "seed-1"
          ]
        },
        {
          "id": "quadratic-equation",
          "title": "一元二次方程",
          "goal": "会用求根公式/因式分解解一元二次方程",
          "estMinutes": 15,
          "verifyHint": "解 x² - 5x + 6 = 0，说明用的方法",
          "ownership": "group",
          "ownerId": null,
          "version": "seed-1",
          "versions": [
            "seed-1"
          ]
        },
        {
          "id": "function-intro",
          "title": "函数初步",
          "goal": "理解函数概念，会画简单函数图像",
          "estMinutes": 12,
          "verifyHint": "解释「y = 2x」里 x 与 y 的对应关系",
          "ownership": "group",
          "ownerId": null,
          "version": "seed-1",
          "versions": [
            "seed-1"
          ]
        },
        {
          "id": "basic-shapes",
          "title": "基本图形",
          "goal": "认识点、线、面、角的基本概念",
          "estMinutes": 8,
          "verifyHint": "说出线段、射线、直线的区别",
          "ownership": "group",
          "ownerId": null,
          "version": "seed-1",
          "versions": [
            "seed-1"
          ]
        },
        {
          "id": "angle",
          "title": "角",
          "goal": "理解角的度量，掌握余角补角",
          "estMinutes": 10,
          "verifyHint": "画一个 60° 角并量出它的补角",
          "ownership": "group",
          "ownerId": null,
          "version": "seed-1",
          "versions": [
            "seed-1"
          ]
        },
        {
          "id": "parallel-lines",
          "title": "平行线",
          "goal": "理解平行线性质与判定（同位角/内错角）",
          "estMinutes": 12,
          "verifyHint": "画两条平行线被第三条线截，标出内错角并说明相等",
          "ownership": "group",
          "ownerId": null,
          "version": "seed-1",
          "versions": [
            "seed-1"
          ]
        },
        {
          "id": "triangle",
          "title": "三角形",
          "goal": "掌握三角形内角和、三边关系",
          "estMinutes": 10,
          "verifyHint": "证明三角形内角和 180°",
          "ownership": "group",
          "ownerId": null,
          "version": "seed-1",
          "versions": [
            "seed-1"
          ]
        },
        {
          "id": "congruent",
          "title": "全等三角形",
          "goal": "掌握全等判定（SSS/SAS/ASA/AAS/HL）",
          "estMinutes": 15,
          "verifyHint": "证明两个三角形全等并说明用了哪条判定",
          "ownership": "group",
          "ownerId": null,
          "version": "seed-1",
          "versions": [
            "seed-1"
          ]
        },
        {
          "id": "similar",
          "title": "相似三角形",
          "goal": "掌握相似判定与比例性质",
          "estMinutes": 15,
          "verifyHint": "判断两个三角形是否相似并说明理由",
          "ownership": "group",
          "ownerId": null,
          "version": "seed-1",
          "versions": [
            "seed-1"
          ]
        },
        {
          "id": "pythagorean",
          "title": "勾股定理",
          "goal": "会用勾股定理求直角三角形的边",
          "estMinutes": 12,
          "verifyHint": "已知两直角边求斜边，并说明为什么成立",
          "ownership": "group",
          "ownerId": null,
          "version": "seed-1",
          "versions": [
            "seed-1"
          ]
        },
        {
          "id": "circle",
          "title": "圆",
          "goal": "掌握圆的周长、面积与弦、弧",
          "estMinutes": 12,
          "verifyHint": "求半径 5 的圆周长面积并解释公式来源",
          "ownership": "group",
          "ownerId": null,
          "version": "seed-1",
          "versions": [
            "seed-1"
          ]
        },
        {
          "id": "chase-problem",
          "title": "追及问题",
          "goal": "用一元一次方程解追及类应用题",
          "estMinutes": 12,
          "verifyHint": "列方程解一道追及问题",
          "ownership": "group",
          "ownerId": null,
          "version": "seed-1",
          "versions": [
            "seed-1"
          ]
        },
        {
          "id": "concentration-problem",
          "title": "浓度问题",
          "goal": "用一元一次方程解浓度类应用题",
          "estMinutes": 12,
          "verifyHint": "列方程解一道浓度问题",
          "ownership": "group",
          "ownerId": null,
          "version": "seed-1",
          "versions": [
            "seed-1"
          ]
        },
        {
          "id": "profit-loss-problem",
          "title": "盈亏问题",
          "goal": "用一元一次方程解盈亏类应用题",
          "estMinutes": 12,
          "verifyHint": "列方程解一道盈亏问题",
          "ownership": "group",
          "ownerId": null,
          "version": "seed-1",
          "versions": [
            "seed-1"
          ]
        }
      ],
      "edges": [
        {
          "from": "natural-numbers",
          "to": "integers",
          "type": "prereq"
        },
        {
          "from": "integers",
          "to": "rational-numbers",
          "type": "prereq"
        },
        {
          "from": "rational-numbers",
          "to": "real-numbers",
          "type": "prereq"
        },
        {
          "from": "integers",
          "to": "add-subtract",
          "type": "prereq"
        },
        {
          "from": "add-subtract",
          "to": "multiply-divide",
          "type": "prereq"
        },
        {
          "from": "multiply-divide",
          "to": "mixed-operations",
          "type": "prereq"
        },
        {
          "from": "multiply-divide",
          "to": "exponent",
          "type": "prereq"
        },
        {
          "from": "exponent",
          "to": "square-root",
          "type": "prereq"
        },
        {
          "from": "real-numbers",
          "to": "square-root",
          "type": "prereq"
        },
        {
          "from": "rational-numbers",
          "to": "algebraic-expression",
          "type": "prereq"
        },
        {
          "from": "mixed-operations",
          "to": "algebraic-expression",
          "type": "prereq"
        },
        {
          "from": "algebraic-expression",
          "to": "like-terms",
          "type": "prereq"
        },
        {
          "from": "like-terms",
          "to": "linear-equation",
          "type": "prereq"
        },
        {
          "from": "linear-equation",
          "to": "system-linear",
          "type": "prereq"
        },
        {
          "from": "linear-equation",
          "to": "quadratic-equation",
          "type": "prereq"
        },
        {
          "from": "square-root",
          "to": "quadratic-equation",
          "type": "prereq"
        },
        {
          "from": "quadratic-equation",
          "to": "function-intro",
          "type": "prereq"
        },
        {
          "from": "basic-shapes",
          "to": "angle",
          "type": "prereq"
        },
        {
          "from": "angle",
          "to": "parallel-lines",
          "type": "prereq"
        },
        {
          "from": "angle",
          "to": "triangle",
          "type": "prereq"
        },
        {
          "from": "triangle",
          "to": "congruent",
          "type": "prereq"
        },
        {
          "from": "congruent",
          "to": "similar",
          "type": "prereq"
        },
        {
          "from": "triangle",
          "to": "pythagorean",
          "type": "prereq"
        },
        {
          "from": "pythagorean",
          "to": "circle",
          "type": "prereq"
        },
        {
          "from": "chase-problem",
          "to": "linear-equation",
          "type": "instance-of"
        },
        {
          "from": "concentration-problem",
          "to": "linear-equation",
          "type": "instance-of"
        },
        {
          "from": "profit-loss-problem",
          "to": "linear-equation",
          "type": "instance-of"
        }
      ],
      "tutorials": [
        {
          "id": "linear-equation-move-terms",
          "nodeId": "linear-equation",
          "title": "移项合并法",
          "method": "1. 移项（过等号变号）；2. 合并同类项；3. 系数化 1。例：3x + 5 = 20 → 3x = 20 - 5 → 3x = 15 → x = 5。",
          "authorId": "seed",
          "hostInstanceId": "self",
          "visibility": "folded",
          "license": "open",
          "unlockRules": null,
          "version": "seed-1"
        },
        {
          "id": "linear-equation-number-line",
          "nodeId": "linear-equation",
          "title": "数轴图像法",
          "method": "把方程看成数轴上两点重合：左边 3x+5 与右边 20 相等，即在数轴上找到同一点。适合建立直观理解。",
          "authorId": "seed",
          "hostInstanceId": "self",
          "visibility": "folded",
          "license": "open",
          "unlockRules": null,
          "version": "seed-1"
        },
        {
          "id": "rational-numbers-common-denominator",
          "nodeId": "rational-numbers",
          "title": "通分法（分数加减）",
          "method": "异分母分数相加减，先找分母最小公倍数通分，再分子相加减，最后约分。例：1/2 + 1/3 = 3/6 + 2/6 = 5/6。",
          "authorId": "seed",
          "hostInstanceId": "self",
          "visibility": "folded",
          "license": "open",
          "unlockRules": null,
          "version": "seed-1"
        }
      ],
      "issues": [],
      "lightups": []
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
