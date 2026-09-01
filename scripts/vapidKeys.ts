import webpush from "web-push";

/**
 * Printed rather than written anywhere: the private key is a secret, so it goes
 * into the operator's environment by hand and never into the repository or the
 * database.
 */
export function formatVapidEnv(keys: { publicKey: string; privateKey: string }): string {
  return `VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}`;
}

if (process.argv[1]?.endsWith("vapidKeys.ts") === true) {
  console.log(formatVapidEnv(webpush.generateVAPIDKeys()));
}
