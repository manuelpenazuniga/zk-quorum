import { createVoterApp, defaultVoterDeps } from "./voterApp.js";
import { mount } from "../shared/dom.js";
import { loadAppConfig } from "../shared/config.js";

const target = document.getElementById("app");
if (target === null) {
  throw new Error("missing #app root");
}
const config = loadAppConfig();
const app = createVoterApp(defaultVoterDeps(config));
mount(target, app.root);
