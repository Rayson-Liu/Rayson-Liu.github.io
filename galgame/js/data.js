/* 桜色クローバー — game data */
window.GAME = window.GAME || {};

GAME.CHARACTERS = {
  sakura: {
    id: "sakura",
    name: "星野 桜",
    nameJa: "星野 桜",
    color: "#f4a0b5",
    hair: "#f0a890",
    intro: "青梅竹马，元气满满。总在中庭或教室附近。",
    portrait: "assets/characters/sakura.png"
  },
  nagi: {
    id: "nagi",
    name: "月島 凪",
    nameJa: "月島 凪",
    color: "#6b8cce",
    hair: "#3d4a7a",
    intro: "图书委员，安静温柔。常驻图书馆。",
    portrait: "assets/characters/nagi.png"
  },
  reina: {
    id: "reina",
    name: "桐谷 玲奈",
    nameJa: "桐谷 玲奈",
    color: "#b08cc8",
    hair: "#d8d0e8",
    intro: "学生会长，优雅果断。走廊与屋顶常见。",
    portrait: "assets/characters/reina.png"
  },
  hiyori: {
    id: "hiyori",
    name: "白石 ひより",
    nameJa: "白石 ひより",
    color: "#d4a574",
    hair: "#c8a070",
    intro: "转学生，神秘温柔。似乎藏着什么秘密。",
    portrait: "assets/characters/hiyori.png"
  }
};

GAME.LOCS = {
  gate:     { id: "gate",     name: "校门口",   bg: "assets/bg/gate.png",     mapX: 50, mapY: 88 },
  courtyard:{ id: "courtyard",name: "中庭",     bg: "assets/bg/courtyard.png",mapX: 50, mapY: 48 },
  classroom:{ id: "classroom",name: "教室",     bg: "assets/bg/classroom.png",mapX: 38, mapY: 22 },
  hallway:  { id: "hallway",  name: "走廊",     bg: "assets/bg/hallway.png",  mapX: 50, mapY: 28 },
  library:  { id: "library",  name: "图书室",   bg: "assets/bg/library.png",  mapX: 72, mapY: 22 },
  rooftop:  { id: "rooftop",  name: "屋顶",     bg: "assets/bg/rooftop.png",  mapX: 38, mapY: 12 },
  cafeteria:{ id: "cafeteria",name: "食堂",     bg: "assets/bg/cafeteria.png",mapX: 22, mapY: 48 },
  gym:      { id: "gym",      name: "体育馆",   bg: "assets/bg/gym.png",      mapX: 78, mapY: 48 }
};

/* NPC schedule: location by phase */
GAME.SCHEDULE = {
  morning: {
    sakura: "classroom",
    nagi: "library",
    reina: "hallway",
    hiyori: "classroom"
  },
  noon: {
    sakura: "cafeteria",
    nagi: "library",
    reina: "cafeteria",
    hiyori: "courtyard"
  },
  afternoon: {
    sakura: "courtyard",
    nagi: "library",
    reina: "hallway",
    hiyori: "rooftop"
  },
  evening: {
    sakura: "gate",
    nagi: "library",
    reina: "rooftop",
    hiyori: "gate"
  }
};

GAME.PHASES = ["morning", "noon", "afternoon", "evening"];
GAME.PHASE_LABELS = {
  morning: "早晨",
  noon: "午休",
  afternoon: "放学后",
  evening: "黄昏"
};

/* ---------- Story scripts ----------
   node format:
   { who, text, bg?, char?, fx? }
   choice: { text, next?, aff?: {id: n}, set?: {k:v} }
   goto: next scene id
   end: ending id
   flag: set flag
*/
GAME.SCENES = {
  /* ===== Prologue ===== */
  prologue: {
    bg: "gate",
    lines: [
      { who: "", text: "四月。樱花纷飞的星见ヶ丘学園。" },
      { who: "", text: "你转学来到这座临海的小镇高中，开始崭新的校园生活。" },
      { who: "", text: "校门口的樱花树下，似乎有人在等谁……" },
      {
        choice: [
          { text: "走过去打个招呼", next: "prologue_sakura", aff: { sakura: 2 } },
          { text: "先去教室报到", next: "prologue_class", aff: {} }
        ]
      }
    ]
  },
  prologue_sakura: {
    bg: "gate",
    lines: [
      { who: "sakura", text: "啊——！真的是你！好久不见！", char: "sakura" },
      { who: "me", text: "樱……？你怎么在这里？" },
      { who: "sakura", text: "嘿嘿，我可是你的青梅竹马诶！听说你要转来，当然要来接你啦！" },
      { who: "sakura", text: "走吧走吧，我带你去教室！对了，放学后中庭见哦，有话想跟你说。" },
      { who: "me", text: "……好。" },
      { who: "", text: "和青梅竹马的重逢，让这个春天似乎变得不太一样了。", fx: "aff+sakura" },
      { next: "explore_tutorial" }
    ]
  },
  prologue_class: {
    bg: "hallway",
    lines: [
      { who: "", text: "你沿着走廊寻找自己的教室。" },
      { who: "reina", text: "等一下。你就是今天转学来的同学吧？", char: "reina" },
      { who: "me", text: "是的。请多关照……" },
      { who: "reina", text: "我是学生会长桐谷玲奈。有什么事可以来学生会找我。" },
      { who: "reina", text: "教室在二楼东侧。……看起来你运气不错，今天天气很好。" },
      { who: "me", text: "谢谢。" },
      { who: "", text: "会长微微一笑，转身离开。背影笔直而从容。" },
      { next: "explore_tutorial" }
    ]
  },

  explore_tutorial: {
    bg: "courtyard",
    lines: [
      { who: "", text: "放学后。校园里樱花正盛。" },
      { who: "", text: "—— 开放世界探索模式 ——" },
      { who: "", text: "使用 WASD / 方向键在校园中移动，按 E 与人物或地点互动。" },
      { who: "", text: "在中庭、教室、图书室、屋顶、食堂等地点，或许能遇见她们。" },
      { who: "", text: "多和大家说话，提升好感度，解锁专属剧情吧。" },
      { who: "", text: "按 M 查看校园地图，Tab 查看好感度。" },
      { next: "enter_explore" }
    ]
  },

  /* ===== Sakura events ===== */
  sakura_courtyard_1: {
    bg: "courtyard",
    lines: [
      { who: "sakura", text: "你果然来了！我就知道你会记得。", char: "sakura" },
      { who: "sakura", text: "看，这棵樱花树——我们小时候也一起看过吧？" },
      { who: "me", text: "……嗯。那时候你总爬到很高的地方。" },
      { who: "sakura", text: "才没有！……好吧有过一次。嘿嘿。" },
      {
        choice: [
          { text: "「今年也一起看樱花吧。」", next: "sakura_c1_a", aff: { sakura: 3 } },
          { text: "「你好像和以前不太一样了。」", next: "sakura_c1_b", aff: { sakura: 2 } },
          { text: "沉默地望着花瓣", next: "sakura_c1_c", aff: { sakura: 1 } }
        ]
      }
    ]
  },
  sakura_c1_a: {
    bg: "courtyard",
    lines: [
      { who: "sakura", text: "……！真的吗？说好了哦！", char: "sakura" },
      { who: "sakura", text: "拉钩！不许反悔！", char: "sakura" },
      { who: "me", text: "好，拉钩。" },
      { who: "", text: "她的手指勾住你的，温暖而用力。花瓣落在发间。", fx: "aff+sakura" },
      { next: "explore_resume" }
    ]
  },
  sakura_c1_b: {
    bg: "courtyard",
    lines: [
      { who: "sakura", text: "有吗？我还是我呀。", char: "sakura" },
      { who: "sakura", text: "……不过，能再见到你，真的很开心。" },
      { who: "me", text: "我也是。" },
      { who: "", text: "她别过脸去，耳尖却微微泛红。", fx: "aff+sakura" },
      { next: "explore_resume" }
    ]
  },
  sakura_c1_c: {
    bg: "courtyard",
    lines: [
      { who: "sakura", text: "……你在想什么？", char: "sakura" },
      { who: "me", text: "在想，春天真短啊。" },
      { who: "sakura", text: "所以才要珍惜现在呀。……那个，下次也一起走走吧？" },
      { who: "", text: "轻声的邀约，像落在水面的花瓣。", fx: "aff+sakura" },
      { next: "explore_resume" }
    ]
  },
  sakura_cafeteria_1: {
    bg: "cafeteria",
    lines: [
      { who: "sakura", text: "喂——这边这边！我帮你占了位子！", char: "sakura" },
      { who: "sakura", text: "今天有草莓大福！我买了两份，分你一份！" },
      { who: "me", text: "你也太照顾我了……" },
      { who: "sakura", text: "因为你是重要的青梅竹马嘛。快吃快吃！" },
      {
        choice: [
          { text: "道谢并吃掉大福", next: "sakura_caf_a", aff: { sakura: 2 } },
          { text: "把她喜欢的那份也给她", next: "sakura_caf_b", aff: { sakura: 3 } }
        ]
      }
    ]
  },
  sakura_caf_a: {
    bg: "cafeteria",
    lines: [
      { who: "me", text: "谢谢，很好吃。" },
      { who: "sakura", text: "嘿嘿，那就好！下次再一起吃！" },
      { next: "explore_resume" }
    ]
  },
  sakura_caf_b: {
    bg: "cafeteria",
    lines: [
      { who: "me", text: "……你那份看起来更想吃。都给你。" },
      { who: "sakura", text: "诶？真的可以吗？……你、你真是的！" },
      { who: "sakura", text: "那……那我们一起分着吃吧。一人一半。" },
      { who: "", text: "草莓的甜味，和她笑起来的样子，一起留在了午后的食堂。", fx: "aff+sakura" },
      { next: "explore_resume" }
    ]
  },
  sakura_confession: {
    bg: "courtyard",
    lines: [
      { who: "sakura", text: "那个……我有话想对你说。", char: "sakura" },
      { who: "sakura", text: "从小的时候起，我就……一直一直，最喜欢你了。" },
      { who: "sakura", text: "不是青梅竹马的那种喜欢。是……想一直待在你身边的那种。" },
      { who: "sakura", text: "你……愿意接受我吗？" },
      {
        choice: [
          { text: "「我也一直喜欢你。」", next: "ending_sakura", aff: { sakura: 10 } },
          { text: "「让我再想想。」", next: "explore_resume", aff: { sakura: -1 } }
        ]
      }
    ]
  },

  /* ===== Nagi events ===== */
  nagi_library_1: {
    bg: "library",
    lines: [
      { who: "nagi", text: "……嘘。这里是图书室。", char: "nagi" },
      { who: "me", text: "抱歉，太大声了？" },
      { who: "nagi", text: "没有。只是……很少有人会主动来找图书委员说话。" },
      { who: "nagi", text: "我叫月島凪。你若是想找书，我可以帮忙。" },
      {
        choice: [
          { text: "「你在看什么书？」", next: "nagi_c1_a", aff: { nagi: 3 } },
          { text: "「有什么推荐吗？」", next: "nagi_c1_b", aff: { nagi: 2 } },
          { text: "安静地在旁边坐下", next: "nagi_c1_c", aff: { nagi: 2 } }
        ]
      }
    ]
  },
  nagi_c1_a: {
    bg: "library",
    lines: [
      { who: "nagi", text: "……一本关于四叶草的随笔。", char: "nagi" },
      { who: "nagi", text: "据说找到四叶草的人，会得到小小的幸福。" },
      { who: "me", text: "你信这些吗？" },
      { who: "nagi", text: "……我更相信，幸福是要自己去寻找的。" },
      { who: "", text: "她抬眼看你，镜片后的目光柔和而认真。", fx: "aff+nagi" },
      { next: "explore_resume" }
    ]
  },
  nagi_c1_b: {
    bg: "library",
    lines: [
      { who: "nagi", text: "推荐……嗯。这本诗集，很适合春天读。", char: "nagi" },
      { who: "nagi", text: "如果你不介意的话……我们可以一起读。" },
      { who: "me", text: "好啊。" },
      { who: "", text: "午后的图书馆，只剩下翻页声和两人交叠的影子。", fx: "aff+nagi" },
      { next: "explore_resume" }
    ]
  },
  nagi_c1_c: {
    bg: "library",
    lines: [
      { who: "", text: "你静静坐在她对面。她没有说话，却把书往你的方向推了推。" },
      { who: "nagi", text: "……一起看吧。" },
      { who: "", text: "有些陪伴，不需要言语。", fx: "aff+nagi" },
      { next: "explore_resume" }
    ]
  },
  nagi_library_2: {
    bg: "library",
    lines: [
      { who: "nagi", text: "你又来了。", char: "nagi" },
      { who: "nagi", text: "……我很高兴。真的。" },
      { who: "nagi", text: "这个，给你。是我做的四叶草书签。" },
      { who: "me", text: "谢谢……好精致。" },
      { who: "nagi", text: "希望它能带给你，一点点幸福。" },
      {
        choice: [
          { text: "「有你在的地方，就已经很幸福了。」", next: "nagi_sweet", aff: { nagi: 4 } },
          { text: "「我会好好珍惜的。」", next: "explore_resume", aff: { nagi: 2 } }
        ]
      }
    ]
  },
  nagi_sweet: {
    bg: "library",
    lines: [
      { who: "nagi", text: "……！", char: "nagi" },
      { who: "nagi", text: "你、你突然说这种话……我会当真的。" },
      { who: "me", text: "我本来就是认真的。" },
      { who: "nagi", text: "……那、那我也……希望你能一直来图书室。" },
      { who: "", text: "她的耳尖红了，却仍认真地看着你。", fx: "aff+nagi" },
      { next: "explore_resume" }
    ]
  },
  nagi_confession: {
    bg: "library",
    lines: [
      { who: "nagi", text: "……可以耽误你一点时间吗？", char: "nagi" },
      { who: "nagi", text: "我一直在想，如果不说出口，或许就永远只是图书室的过客了。" },
      { who: "nagi", text: "我喜欢你。不是对借书人的喜欢，是对「你」的喜欢。" },
      { who: "nagi", text: "……你愿意，成为我故事的下一页吗？" },
      {
        choice: [
          { text: "「我愿意。」", next: "ending_nagi", aff: { nagi: 10 } },
          { text: "「凪……对不起。」", next: "explore_resume", aff: { nagi: -1 } }
        ]
      }
    ]
  },

  /* ===== Reina events ===== */
  reina_hallway_1: {
    bg: "hallway",
    lines: [
      { who: "reina", text: "又见面了。转学生。", char: "reina" },
      { who: "reina", text: "适应得怎么样？如果有困难，不必勉强自己一个人扛。" },
      { who: "me", text: "还好。大家都很友善。" },
      { who: "reina", text: "那就好。……其实，有件事想拜托你。" },
      { who: "reina", text: "文化祭临近了，学生会人手不够。你愿意帮忙吗？" },
      {
        choice: [
          { text: "「我很乐意帮忙。」", next: "reina_help", aff: { reina: 3 } },
          { text: "「我能做什么？」", next: "reina_ask", aff: { reina: 2 } },
          { text: "「抱歉，可能不太方便。」", next: "reina_decline", aff: { reina: 0 } }
        ]
      }
    ]
  },
  reina_help: {
    bg: "hallway",
    lines: [
      { who: "reina", text: "……谢谢。你比想象中更靠得住。", char: "reina" },
      { who: "reina", text: "放学后学生会室见。我会准备茶的。" },
      { who: "", text: "会长的微笑里，少了一分距离，多了一分温度。", fx: "aff+reina" },
      { next: "explore_resume" }
    ]
  },
  reina_ask: {
    bg: "hallway",
    lines: [
      { who: "reina", text: "布置会场、整理资料、联络各班……还有，陪我开会时别睡着。", char: "reina" },
      { who: "me", text: "最后一条有点难……" },
      { who: "reina", text: "呵呵。开玩笑的。……欢迎加入，伙伴。" },
      { who: "", text: "她伸出手。握手时，掌心微微发凉，却很坚定。", fx: "aff+reina" },
      { next: "explore_resume" }
    ]
  },
  reina_decline: {
    bg: "hallway",
    lines: [
      { who: "reina", text: "这样啊。没关系，我理解。", char: "reina" },
      { who: "reina", text: "……不过门一直开着。想通了随时可以来。" },
      { next: "explore_resume" }
    ]
  },
  reina_rooftop_1: {
    bg: "rooftop",
    lines: [
      { who: "reina", text: "……被你发现了。", char: "reina" },
      { who: "reina", text: "这是我的秘密基地。压力大的时候，会一个人上来吹风。" },
      { who: "me", text: "抱歉打扰了。" },
      { who: "reina", text: "不。……你能来，我很高兴。" },
      { who: "reina", text: "在别人面前，我必须是完美的学生会长。只有在这里……" },
      {
        choice: [
          { text: "「在我面前，你不用逞强。」", next: "reina_soft", aff: { reina: 4 } },
          { text: "「会长也会有烦恼吗？」", next: "reina_soft2", aff: { reina: 2 } }
        ]
      }
    ]
  },
  reina_soft: {
    bg: "rooftop",
    lines: [
      { who: "reina", text: "……你这个人，真是。", char: "reina" },
      { who: "reina", text: "明明才认识不久，却总能戳中最柔软的地方。" },
      { who: "reina", text: "……再陪我一会儿吧。就这样，看看夕阳。" },
      { who: "", text: "风吹起她的银发。这一刻，她不是会长，只是一个想被理解的女孩。", fx: "aff+reina" },
      { next: "explore_resume" }
    ]
  },
  reina_soft2: {
    bg: "rooftop",
    lines: [
      { who: "reina", text: "当然会。我只是……比较会藏而已。", char: "reina" },
      { who: "reina", text: "谢谢你上来。下次，可以叫上你一起。" },
      { who: "", text: "夕阳把她的侧脸染成了蜜色。", fx: "aff+reina" },
      { next: "explore_resume" }
    ]
  },
  reina_confession: {
    bg: "rooftop",
    lines: [
      { who: "reina", text: "转学生——不，我想叫你的名字。", char: "reina" },
      { who: "reina", text: "作为会长，我不该把私人感情带进校园。", char: "reina" },
      { who: "reina", text: "但作为桐谷玲奈这个人……我喜欢你。非常喜欢。" },
      { who: "reina", text: "你愿意，接受一个偶尔会任性的我吗？" },
      {
        choice: [
          { text: "「不管哪个你，我都喜欢。」", next: "ending_reina", aff: { reina: 10 } },
          { text: "「玲奈……你很好，但我……」", next: "explore_resume", aff: { reina: -1 } }
        ]
      }
    ]
  },

  /* ===== Hiyori events ===== */
  hiyori_rooftop_1: {
    bg: "rooftop",
    lines: [
      { who: "hiyori", text: "啊……有人来了。", char: "hiyori" },
      { who: "hiyori", text: "你好。我是白石ひより，上周刚转来的。" },
      { who: "me", text: "我也是转学生。请多关照。" },
      { who: "hiyori", text: "……是吗。那我们是同类呢。" },
      { who: "hiyori", text: "你看，从这里能看到整个小镇。大海也在远处。" },
      {
        choice: [
          { text: "「为什么会转来这里？」", next: "hiyori_why", aff: { hiyori: 3 } },
          { text: "「风景真好。」", next: "hiyori_scenery", aff: { hiyori: 2 } }
        ]
      }
    ]
  },
  hiyori_why: {
    bg: "rooftop",
    lines: [
      { who: "hiyori", text: "……因为，在找一样东西。", char: "hiyori" },
      { who: "hiyori", text: "小时候在这里丢掉的，很重要的东西。" },
      { who: "me", text: "找到了吗？" },
      { who: "hiyori", text: "还没有。不过……遇到你之后，总觉得会找到的。" },
      { who: "", text: "她微笑着，眼底却藏着说不清的寂寞。", fx: "aff+hiyori" },
      { next: "explore_resume" }
    ]
  },
  hiyori_scenery: {
    bg: "rooftop",
    lines: [
      { who: "hiyori", text: "嗯。我每天都会来看。", char: "hiyori" },
      { who: "hiyori", text: "……一个人看的时候，总觉得少了点什么。" },
      { who: "hiyori", text: "今天，好像有点不一样了。" },
      { who: "", text: "四叶草形状的发饰，在夕光里轻轻晃了一下。", fx: "aff+hiyori" },
      { next: "explore_resume" }
    ]
  },
  hiyori_courtyard_1: {
    bg: "courtyard",
    lines: [
      { who: "hiyori", text: "你看——这棵树下，据说藏着幸运。", char: "hiyori" },
      { who: "hiyori", text: "小时候，我在这里埋过一个时间胶囊。" },
      { who: "me", text: "要一起挖出来吗？" },
      { who: "hiyori", text: "……嗯。如果是和你一起的话。" },
      {
        choice: [
          { text: "立刻动手挖", next: "hiyori_dig", aff: { hiyori: 3 } },
          { text: "「还是等到更有意义的日子吧。」", next: "hiyori_wait", aff: { hiyori: 2 } }
        ]
      }
    ]
  },
  hiyori_dig: {
    bg: "courtyard",
    lines: [
      { who: "", text: "你们在樱花树下挖出了一个生锈的小铁盒。" },
      { who: "hiyori", text: "……找到了。里面有信，还有……一枚四叶草标本。" },
      { who: "hiyori", text: "信上写着：「给未来的自己——希望你找到了想要守护的人。」" },
      { who: "hiyori", text: "……我好像，找到了。" },
      { who: "", text: "她看着你，眼里有泪光，也有笑意。", fx: "aff+hiyori" },
      { next: "explore_resume" }
    ]
  },
  hiyori_wait: {
    bg: "courtyard",
    lines: [
      { who: "hiyori", text: "……有意义的日子，吗。", char: "hiyori" },
      { who: "hiyori", text: "那……等文化祭结束的那天，我们一起打开它，好不好？" },
      { who: "me", text: "好，约定好了。" },
      { who: "hiyori", text: "嗯。约好了。" },
      { who: "", text: "她伸出小指。樱花落在交叠的指尖上。", fx: "aff+hiyori" },
      { next: "explore_resume" }
    ]
  },
  hiyori_confession: {
    bg: "rooftop",
    lines: [
      { who: "hiyori", text: "有一件事，一直没告诉你。", char: "hiyori" },
      { who: "hiyori", text: "我转来这里，是因为小时候……我在这里遇见了一个男孩。" },
      { who: "hiyori", text: "他给了我一枚四叶草，说「幸运会找到你的」。" },
      { who: "hiyori", text: "……那个男孩，是你吧？" },
      { who: "me", text: "……ひより？" },
      { who: "hiyori", text: "我一直在找你。现在找到了，我不想再错过了。" },
      { who: "hiyori", text: "我喜欢你。从很小很小的时候就喜欢。" },
      {
        choice: [
          { text: "「我也一直在等你。」", next: "ending_hiyori", aff: { hiyori: 10 } },
          { text: "「ひより……谢谢你告诉我。」", next: "explore_resume", aff: { hiyori: 2 } }
        ]
      }
    ]
  },

  /* ===== Endings ===== */
  ending_sakura: {
    bg: "courtyard",
    ending: {
      id: "sakura",
      title: "樱色约定",
      char: "sakura",
      text: "樱花纷飞的中庭里，你们终于说出了藏在心底多年的话。\n\n「从今以后，也一直在一起吧。」\n\n她笑着点头，眼角闪着光。\n\n春天才刚刚开始。而你们的故事，也在这一树樱花下，翻开了崭新的一页。\n\n—— 星野 桜 END ——"
    }
  },
  ending_nagi: {
    bg: "library",
    ending: {
      id: "nagi",
      title: "四叶书签",
      char: "nagi",
      text: "图书室的午后，阳光落在交叠的手上。\n\n「从今以后，借书卡上会写上两个人的名字。」\n\n她轻声说着，却认真得像在立下誓言。\n\n四叶草书签夹在同一页——那是属于你们的，幸福标记。\n\n—— 月島 凪 END ——"
    }
  },
  ending_reina: {
    bg: "rooftop",
    ending: {
      id: "reina",
      title: "会长的任性",
      char: "reina",
      text: "屋顶的风，吹散了她一直端着的完美假面。\n\n「只有在你面前，我可以不用当会长。」\n\n你握住她的手。夕阳把两个人的影子拉得很长。\n\n文化祭会成功，未来也还很长。\n\n但此刻，只想和她一起看日落。\n\n—— 桐谷 玲奈 END ——"
    }
  },
  ending_hiyori: {
    bg: "rooftop",
    ending: {
      id: "hiyori",
      title: "重逢的四叶草",
      char: "hiyori",
      text: "原来幸运不是找到四叶草，而是找到你。\n\n「这一次，我不会再弄丢你了。」\n\n她把那枚褪色的四叶草标本放进你手心。\n\n小镇的风里带着海的味道。故事回到了起点，却走向了更远的远方。\n\n—— 白石 ひより END ——"
    }
  },
  ending_alone: {
    bg: "gate",
    ending: {
      id: "alone",
      title: "普通的春天",
      char: null,
      text: "樱花落了又开，校园生活平静地继续着。\n\n你和大家都成了不错的朋友。\n\n只是偶尔经过中庭时，会想起那些未说出口的话。\n\n也许下一个春天，会有不一样的故事。\n\n—— NORMAL END ——"
    }
  },

  /* special: day advance toast handled in engine */
};

/* Random / ambient one-liners for repeat talks */
GAME.AMBIENT = {
  sakura: [
    "今天也要加油哦！",
    "放学后要不要一起去买可乐饼？",
    "你看，樱花又开了好多！",
    "嘿嘿，见到你真好。",
    "中庭的风，吹得人想伸懒腰。",
    "如果困了，就来中庭找我聊天吧。",
    "对了，食堂今天的布丁好像不错。",
  ],
  nagi: [
    "……欢迎回来。",
    "新到了一批推理小说，有兴趣吗？",
    "安静的下午，很适合读书。",
    "你坐这里就好。……不打扰。",
    "书页翻动的声音，其实很治愈。",
    "这本诗集我帮你留着了。",
    "……你今天好像有点累？歇一会儿吧。",
  ],
  reina: [
    "学生会的工作还顺利。",
    "……有你在，效率好像变高了。",
    "文化祭的企划，要不要看看？",
    "偶尔也该放松一下。",
    "走廊很适合散步，想事情的时候我常走这里。",
    "……别盯着我看太久。",
    "有困难就说，不必一个人扛。",
  ],
  hiyori: [
    "风好舒服。",
    "小镇的天空，和以前一样蓝。",
    "……能遇到你，真好。",
    "四叶草在风里轻轻摇呢。",
    "从屋顶往下看，校园好像模型一样。",
    "你有没有……想起过小时候的事？",
    "今天阳光很温柔，像棉花糖。",
  ],
};

/* Confession trigger: affection >= threshold and certain day+ */
GAME.CONFESSION_THRESHOLD = 12;
GAME.CONFESSION_MIN_DAY = 3;
