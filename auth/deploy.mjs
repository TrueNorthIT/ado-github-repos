// Builds and zip-deploys the function to an existing Flex Consumption app.
// Needs az signed in to the right identity (AZURE_CONFIG_DIR) and:
//   AZ_SUBSCRIPTION, AZ_RESOURCE_GROUP, AZ_FUNCTION_APP
import { execSync } from "node:child_process";

const env = ["AZ_SUBSCRIPTION", "AZ_RESOURCE_GROUP", "AZ_FUNCTION_APP"];
const missing = env.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Set ${missing.join(", ")} first (see README).`);
  process.exit(1);
}
const { AZ_SUBSCRIPTION: sub, AZ_RESOURCE_GROUP: rg, AZ_FUNCTION_APP: app } = process.env;
const run = (cmd) => execSync(cmd, { stdio: "inherit" });

run("npm run build");
run("npm prune --omit=dev");
try {
  run("func pack --no-build -o dist");
  run(`az functionapp deployment source config-zip -g "${rg}" -n "${app}" --subscription "${sub}" --src dist/auth.zip --build-remote false`);
} finally {
  run("npm install"); // restore devDependencies even if the deploy fails
}
