/**
 * WebGL game catalog — add one object per Unity WebGL build.
 * buildPath: Unity index.html under static/webgl/ (served as /static/webgl/... or /webgl/... on Netlify).
 */
window.WEBGL_GAMES = [
  {
    slug: "2d-car",
    title: "Beat Traffic",
    desc: "Rush hour challenge — steer from your phone while the game runs in the browser.",
    img: "/assets/games/beat-traffic.png",
    buildPath: "/static/webgl/2dCar/index.html",
    phoneControllerUrl: "https://phonecontrollerserver.onrender.com",
    badge: "WebGL",
    orientation: "portrait",
    aspectRatio: "9 / 16",
  },
  {
    slug: "fruit-ninja",
    title: "Ayzen Fruit Ninja",
    desc: "Slice haunted fruit with your phone as the sword — gyro slash controls in the browser.",
    img: "/assets/games/spooky-fruit-ninja.png",
    buildPath: "/static/webgl/Fruitninjawebgl/index.html",
    phoneControllerUrl: "https://fruit-ninja-phonecontroller.onrender.com",
    badge: "WebGL",
    orientation: "landscape",
    aspectRatio: "16 / 9",
    canvasWidth: 1920,
    canvasHeight: 1080,
  },
  {
    slug: "soundora",
    title: "Soundora",
    desc: "Describe a mood, genre, or story — Soundora composes original AI-generated songs in your browser.",
    img: "/assets/games/soundora.svg",
    buildPath: "/static/webgl/AI-Musicapp/index.html",
    badge: "AI Music",
    appType: "standalone",
    comingSoon: false,
    orientation: "portrait",
    aspectRatio: "9 / 16",
    homeHref: "/soundora",
  },
];
