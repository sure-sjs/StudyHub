/**
 * StudyHub V0.1.1 —— 首次访问的种子数据
 * ------------------------------------------------------------------
 * 从 V0.1.1 起，网站的增删改都在页面里完成，运行时数据整体存放在
 * localStorage（键 studyhub:v1，version 2）。这里的数据只在浏览器
 * 还没有本地数据时用来播种；已有数据后修改本文件不会影响已保存的记录。
 *
 * 字段说明：
 *   id             唯一标识，写入 localStorage 后作为站点主键，创建后不要修改
 *   name           网站名称
 *   desc           一句话用途说明
 *   url            真实网址（2026-11-03 实测可访问）
 *   category       所属分类 id，对应 categories[].id
 *   icon           图标名，对应 index.html 中 <symbol id="i-xxx">
 *   color          站点主色，用于图标底色与标签着色
 *   tags           展示用标签，V0.2 搜索也将使用
 *   initialVisits  首次播种时的初始次数，之后完全由真实访问累计
 *   seededHoursAgo 首次播种时的「最近访问」初始时间（相对当前小时数），
 *                  仅用于让最近访问区域在首次打开时有内容
 * ------------------------------------------------------------------
 */
window.STUDYHUB_DATA = {
  meta: {
    version: "0.1.1",
    updatedAt: "2026-11-03",
    storageKey: "studyhub:v1"
  },

  categories: [
    { id: "course",  name: "课程学习", icon: "i-cap",  color: "#3b6fe0" },
    { id: "coding",  name: "编程开发", icon: "i-code", color: "#6d5ce7" },
    { id: "major",   name: "专业学习", icon: "i-flask", color: "#0f9d8a" },
    { id: "docs",    name: "文献资料", icon: "i-book", color: "#d9822b" },
    { id: "campus",  name: "校园生活", icon: "i-home", color: "#d6537a" }
  ],

  sites: [
    {
      id: "icourse163",
      name: "中国大学MOOC",
      desc: "高校在线课程平台，配合专业课预习与复习。",
      url: "https://www.icourse163.org/",
      category: "course",
      icon: "i-video",
      color: "#1a9c62",
      tags: ["课程", "公开课"],
      initialVisits: 96,
      seededHoursAgo: 7
    },
    {
      id: "xuetangx",
      name: "学堂在线",
      desc: "清华大学发起的慕课平台，覆盖理工与人文。",
      url: "https://www.xuetangx.com/",
      category: "course",
      icon: "i-play",
      color: "#6d5ce7",
      tags: ["课程", "慕课"],
      initialVisits: 48,
      seededHoursAgo: null
    },
    {
      id: "open163",
      name: "网易公开课",
      desc: "国内外名校公开课与 TED 演讲合集。",
      url: "https://open.163.com/",
      category: "course",
      icon: "i-monitor",
      color: "#c9483c",
      tags: ["课程", "公开课"],
      initialVisits: 28,
      seededHoursAgo: null
    },
    {
      id: "github",
      name: "GitHub",
      desc: "代码托管与开源项目管理。",
      url: "https://github.com/",
      category: "coding",
      icon: "i-branch",
      color: "#24292f",
      tags: ["编程", "工具"],
      initialVisits: 128,
      seededHoursAgo: 3
    },
    {
      id: "mdn",
      name: "MDN Web Docs",
      desc: "Web 开发权威文档与教程。",
      url: "https://developer.mozilla.org/zh-CN/",
      category: "coding",
      icon: "i-code-doc",
      color: "#1b6fa8",
      tags: ["开发", "文档"],
      initialVisits: 72,
      seededHoursAgo: 26
    },
    {
      id: "stackoverflow",
      name: "Stack Overflow",
      desc: "程序员问答社区，排查报错先用它。",
      url: "https://stackoverflow.com/",
      category: "coding",
      icon: "i-layers",
      color: "#d97706",
      tags: ["开发", "问答"],
      initialVisits: 40,
      seededHoursAgo: null
    },
    {
      id: "muchong",
      name: "小木虫",
      desc: "学术科研交流社区，考研与论文经验多。",
      url: "https://muchong.com/",
      category: "major",
      icon: "i-bug",
      color: "#0f9d8a",
      tags: ["科研", "社区"],
      initialVisits: 36,
      seededHoursAgo: null
    },
    {
      id: "sciencenet",
      name: "科学网",
      desc: "华人科学社区，学术资讯与科研博客。",
      url: "https://www.sciencenet.cn/",
      category: "major",
      icon: "i-atom",
      color: "#2f6fdb",
      tags: ["科研", "资讯"],
      initialVisits: 34,
      seededHoursAgo: null
    },
    {
      id: "cie",
      name: "中国电子学会",
      desc: "电子信息领域学术活动与行业动态。",
      url: "https://www.cie.org.cn/",
      category: "major",
      icon: "i-chip",
      color: "#6d5ce7",
      tags: ["电子", "行业"],
      initialVisits: 30,
      seededHoursAgo: null
    },
    {
      id: "cnki",
      name: "中国知网",
      desc: "中文学术文献检索与全文下载。",
      url: "https://www.cnki.net/",
      category: "docs",
      icon: "i-library",
      color: "#c0392b",
      tags: ["文献", "学术"],
      initialVisits: 60,
      seededHoursAgo: 74
    },
    {
      id: "arxiv",
      name: "arXiv",
      desc: "预印本论文库，物理与工程前沿成果。",
      url: "https://arxiv.org/",
      category: "docs",
      icon: "i-file",
      color: "#a52a2a",
      tags: ["文献", "论文"],
      initialVisits: 42,
      seededHoursAgo: null
    },
    {
      id: "baidu-scholar",
      name: "百度学术",
      desc: "中英文文献检索、引用与订阅。",
      url: "https://xueshu.baidu.com/",
      category: "docs",
      icon: "i-search",
      color: "#3457d5",
      tags: ["文献", "检索"],
      initialVisits: 38,
      seededHoursAgo: null
    },
    {
      id: "bit",
      name: "北京理工大学",
      desc: "学校官网，通知公告与机构入口。",
      url: "https://www.bit.edu.cn/",
      category: "campus",
      icon: "i-landmark",
      color: "#1a4f9c",
      tags: ["校园", "官网"],
      initialVisits: 28,
      seededHoursAgo: 52
    },
    {
      id: "bitlib",
      name: "北理工图书馆",
      desc: "馆藏查询、数据库入口与借阅续借。",
      url: "https://lib.bit.edu.cn/",
      category: "campus",
      icon: "i-book",
      color: "#0e7490",
      tags: ["校园", "图书馆"],
      initialVisits: 26,
      seededHoursAgo: null
    },
    {
      id: "weather",
      name: "中国天气网",
      desc: "天气预报与生活指数查询。",
      url: "https://www.weather.com.cn/",
      category: "campus",
      icon: "i-sun",
      color: "#e8890c",
      tags: ["生活", "天气"],
      initialVisits: 22,
      seededHoursAgo: null
    }
  ]
};
