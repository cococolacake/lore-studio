// Runs the bridge's soundscape.mjs against a fake Foundry and prints which sounds played and stopped, as JSON.
// Usage: node fake_soundscape.mjs <file URL of soundscape.mjs>
const log = [];
let hour = 12;
let weather = { id: "rain", label: "Rain" };
const files = new Set(["sounds/forest_day.ogg", "sounds/forest_night.ogg", "sounds/rain.ogg", "sounds/wind.ogg"]);
globalThis.Hooks = { on() {}, once() {}, callAll: () => true };
globalThis.CONST = { GRID_TYPES: { GRIDLESS: 0 } };
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.fetch = async (url) => ({ ok: files.has(String(url).replace(/^\//, "")) });
globalThis.foundry = { utils: { getRoute: (p) => "/" + p, deepClone: (x) => JSON.parse(JSON.stringify(x)) },
  audio: { AudioHelper: { play: async ({ src, volume, loop }) => {
    log.push(`play ${src}${loop ? " loop" : ""}`);
    return { src, fade: (v) => log.push(`fade ${src} ${Math.round(v * 100) / 100}`), stop: () => log.push(`stop ${src}`) };
  } } } };
const store = {
  "lore-studio-bridge.scenerySoundLibrary": {
    sounds: [{ id: "f", name: "Forest", path: "sounds/forest_day.ogg", volume: 0.5 }, { id: "w", name: "Wind", path: "sounds/wind.ogg", volume: 1 },
      { id: "r", name: "Rain", path: "sounds/rain.ogg", volume: 0.8 }],
    weather: { rain: "r", wind: "w" }, scenes: { s1: "f" } },
  "lore-studio-bridge.sceneryFolder": "Static Scenery", "lore-studio-bridge.sceneryWeatherEverywhere": false, "core.globalAmbientVolume": 0.5,
};
globalThis.game = { settings: { register() {}, registerMenu() {}, get: (a, b) => store[`${a}.${b}`] } };
const scene = { id: "s1", name: "Forest", folder: { name: "Static Scenery" } };
globalThis.canvas = { scene };
globalThis.CALENDARIA = { api: { getCurrentDateTime: () => ({ hour, minute: 0 }), getSunrise: () => 6, getSunset: () => 19, getCurrentWeather: () => weather } };
const mod = await import(process.argv[2]);
const wait = () => new Promise((r) => setTimeout(r, 50));
mod.registerSoundscapeSettings();
await mod.updateSoundscape();
const noon = [...log]; log.length = 0;
hour = 23; weather = { id: "sandstorm", label: "Sandstorm" };          // night forest; sandstorm has no sound, falls back to wind
await mod.updateSoundscape(); await wait();
const night = [...log]; log.length = 0;
weather = { id: "clear", label: "Clear" };
await mod.updateSoundscape(); await wait();
// the menu builds without errors (a tiny stand-in for the DOM)
const node = (tag) => ({ tag, kids: [], attrs: {}, style: {}, append(...k) { this.kids.push(...k); }, setAttribute(k, v) { this.attrs[k] = v; },
  addEventListener() {}, replaceChildren(...k) { this.kids = k; } });
globalThis.document = { createElement: node };
game.scenes = { contents: [scene, { id: "s2", name: "Battle", folder: null }] };
const html = await new mod.SoundsMenu()._renderHTML();
const text = (n) => (typeof n === "string" ? n : (n.kids || []).map(text).join(" "));
const menu = text(html);
console.log(JSON.stringify({ noon, night, clear: [...log], menu: ["Your sounds", "Weather sounds", "Scene ambience", "Sandstorm", "Battle"].every((w) => menu.includes(w)) }));
process.exit(0);
