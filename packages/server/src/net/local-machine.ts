import { isIP } from "node:net";
import { networkInterfaces } from "node:os";

const LOOPBACK_LITERALS = new Set(["localhost", "::1"]);

export interface LocalMachineAddressOptions {
  interfaceAddresses?: Iterable<string>;
}

export function isLocalMachineAddress(
  remoteAddress: string | null,
  options: LocalMachineAddressOptions = {},
): boolean {
  const normalized = normalizeAddress(remoteAddress);
  if (!normalized) return false;
  if (isLoopbackAddress(normalized)) return true;

  const localAddresses =
    options.interfaceAddresses ?? collectHostInterfaceAddresses();
  for (const address of localAddresses) {
    if (normalizeAddress(address) === normalized) return true;
  }
  return false;
}

export function collectHostInterfaceAddresses(): string[] {
  const result: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    if (!entries) continue;
    for (const entry of entries) {
      const normalized = normalizeAddress(entry.address);
      if (normalized) result.push(normalized);
    }
  }
  return result;
}

export function normalizeAddress(address: string | null): string | null {
  if (!address) return null;
  let value = address.trim().toLowerCase();
  if (!value) return null;
  if (value.startsWith("[") && value.endsWith("]")) {
    value = value.slice(1, -1);
  }
  const zoneIndex = value.indexOf("%");
  if (zoneIndex >= 0) value = value.slice(0, zoneIndex);

  const dottedMapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value);
  if (dottedMapped) return normalizeIpv4(dottedMapped[1]);

  const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(value);
  if (hexMapped) {
    const high = parseInt(hexMapped[1], 16);
    const low = parseInt(hexMapped[2], 16);
    return [
      (high >>> 8) & 0xff,
      high & 0xff,
      (low >>> 8) & 0xff,
      low & 0xff,
    ].join(".");
  }

  const ipv4 = normalizeIpv4(value);
  if (ipv4) return ipv4;
  if (isIP(value) === 6 || value === "localhost") return value;
  return null;
}

function normalizeIpv4(value: string): string | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const numbers = parts.map((part) => Number(part));
  if (
    numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }
  return numbers.join(".");
}

function isLoopbackAddress(address: string): boolean {
  if (LOOPBACK_LITERALS.has(address)) return true;
  const ipv4 = normalizeIpv4(address);
  return ipv4 !== null && ipv4.split(".")[0] === "127";
}
