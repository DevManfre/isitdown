// Signs the published catalog — roadmap 2.2. Writes catalog/catalog.json.sig,
// the base64 Ed25519 signature over the exact bytes of catalog/catalog.json,
// which is what an install that opted into catalog updates verifies against
// the public key compiled into src/adapters/catalogFeed.ts.
//
// The private key comes from CATALOG_SIGNING_KEY (a PKCS#8 PEM) and nowhere
// else: in CI it is a repository secret, locally it is whatever file the
// operator exports into the variable. A missing key is an error, never an
// unsigned file — an unsigned catalog is one every install would refuse.
//
// CLI: CATALOG_SIGNING_KEY="$(cat key.pem)" node tools/sign-catalog.mjs
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pem = process.env.CATALOG_SIGNING_KEY;
if (pem === undefined || pem.trim() === "") {
  console.error("sign-catalog: CATALOG_SIGNING_KEY is not set");
  process.exit(1);
}

const path = resolve(root, "catalog/catalog.json");
const body = readFileSync(path);
const key = createPrivateKey(pem);
const signature = sign(null, body, key);

// Checked against the key the code ships, so a rotated secret that no longer
// matches it fails here rather than on every install that opted in.
const { CATALOG_PUBLIC_KEY } = await import("../src/adapters/catalogFeed.ts");
if (!verify(null, body, createPublicKey(CATALOG_PUBLIC_KEY), signature)) {
  console.error("sign-catalog: the signing key does not match CATALOG_PUBLIC_KEY in src/adapters/catalogFeed.ts");
  process.exit(1);
}

writeFileSync(`${path}.sig`, `${signature.toString("base64")}\n`);
console.log(`signed ${path}`);
