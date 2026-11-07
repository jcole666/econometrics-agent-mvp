/**
 * 项目标识与本地缓存。
 *
 * 权威数据在 sidecar 本地目录（见 sidecar/services/project_store.py），
 * 这里只负责两件事：
 * 1. 给上传文件算 dataset_id / dataset_hash，保证「换文件不串字典」；
 * 2. 用 localStorage 缓存一份字典，让界面首屏不必等网络。
 */

import type { VariableDictionary } from "./types";

const CACHE_PREFIX = "econometrics-agent.project";

export interface DatasetIdentity {
  dataset_id: string;
  dataset_hash: string;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function fallbackHash(buffer: ArrayBuffer): string {
  // crypto.subtle 在极少数环境下不可用（非安全上下文）；退化到 FNV-1a，
  // 只用于区分文件，不用于任何安全用途。
  let hash = 0x811c9dc5;
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv${hash.toString(16).padStart(8, "0")}`;
}

export async function hashFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  if (typeof crypto !== "undefined" && crypto.subtle) {
    try {
      return toHex(await crypto.subtle.digest("SHA-256", buffer));
    } catch {
      return fallbackHash(buffer);
    }
  }
  return fallbackHash(buffer);
}

export function datasetIdFromName(fileName: string, datasetHash: string): string {
  const stem = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .slice(0, 60);
  const safeStem = stem || "dataset";
  if (safeStem === "sample_city_panel") {
    return "sample_city_panel";
  }
  return `upload_${safeStem}_${datasetHash.slice(0, 8)}`;
}

export async function datasetIdentity(file: File): Promise<DatasetIdentity> {
  const dataset_hash = await hashFile(file);
  return { dataset_id: datasetIdFromName(file.name, dataset_hash), dataset_hash };
}

function cacheKey(datasetId: string, datasetHash: string): string {
  return `${CACHE_PREFIX}.${datasetId}.${datasetHash.slice(0, 16)}`;
}

export function readCachedDictionary(datasetId: string, datasetHash: string): VariableDictionary | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(cacheKey(datasetId, datasetHash));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VariableDictionary;
    return parsed && typeof parsed === "object" && parsed.entries ? parsed : null;
  } catch {
    return null;
  }
}

export function writeCachedDictionary(dictionary: VariableDictionary): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(cacheKey(dictionary.dataset_id, dictionary.dataset_hash), JSON.stringify(dictionary));
  } catch {
    // 配额满或隐私模式：缓存失败不影响主流程。
  }
}

export function clearCachedDictionary(datasetId: string, datasetHash: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(cacheKey(datasetId, datasetHash));
  } catch {
    // 忽略
  }
}
