import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const algorithm = "aes-256-gcm";
const ivLength = 12;
const authTagLength = 16;

const getKey = () => {
  const encodedKey = process.env.KUBECONFIG_ENCRYPTION_KEY;
  if (!encodedKey) {
    throw new Error("KUBECONFIG_ENCRYPTION_KEY is not configured");
  }

  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) {
    throw new Error("KUBECONFIG_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }
  return key;
};

export const encryptKubeconfig = (kubeconfig: string) => {
  const iv = randomBytes(ivLength);
  const cipher = createCipheriv(algorithm, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(kubeconfig, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return ["v1", iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
};

export const decryptKubeconfig = (payload: string) => {
  const [version, encodedIv, encodedAuthTag, encodedCiphertext] = payload.split(":");
  if (version !== "v1" || !encodedIv || !encodedAuthTag || !encodedCiphertext) {
    throw new Error("Invalid encrypted kubeconfig payload");
  }

  const iv = Buffer.from(encodedIv, "base64");
  const authTag = Buffer.from(encodedAuthTag, "base64");
  const ciphertext = Buffer.from(encodedCiphertext, "base64");
  if (iv.length !== ivLength || authTag.length !== authTagLength || ciphertext.length === 0) {
    throw new Error("Invalid encrypted kubeconfig payload");
  }

  const decipher = createDecipheriv(algorithm, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
};