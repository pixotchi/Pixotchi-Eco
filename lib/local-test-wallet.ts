import { getAddress, isAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { isLocalTestAuthAllowed } from "@/lib/local-test-mode";

const LOCAL_TEST_WALLET_KEY = "local-test:pixotchi-wallet";
const AUTH_SURFACE_KEY = "pixotchi:authSurface";
const AUTOLOGIN_KEY = "pixotchi:autologin";
const DEFAULT_LOCAL_TEST_ADDRESS = "0x000000000000000000000000000000000000dEaD" as Address;
const ENV_LOCAL_TEST_PRIVATE_KEY = process.env.NEXT_PUBLIC_LOCAL_TEST_WALLET_PRIVATE_KEY;
const ENV_LOCAL_TEST_CREATED_AT = process.env.NEXT_PUBLIC_LOCAL_TEST_WALLET_CREATED_AT;

type LocalTestWallet = {
  address: Address;
  createdAt: string;
  privateKey: Hex;
  version: 1;
};

function isHexPrivateKey(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function normalizeStoredWallet(value: unknown): LocalTestWallet | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<LocalTestWallet>;
  if (!candidate.address || !isAddress(candidate.address) || !isHexPrivateKey(candidate.privateKey)) {
    return null;
  }

  return {
    address: getAddress(candidate.address),
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : new Date().toISOString(),
    privateKey: candidate.privateKey,
    version: 1,
  };
}

function readConfiguredWallet(): LocalTestWallet | null {
  if (!isHexPrivateKey(ENV_LOCAL_TEST_PRIVATE_KEY)) {
    return null;
  }

  const account = privateKeyToAccount(ENV_LOCAL_TEST_PRIVATE_KEY);
  return {
    address: getAddress(account.address),
    createdAt: ENV_LOCAL_TEST_CREATED_AT || new Date(0).toISOString(),
    privateKey: ENV_LOCAL_TEST_PRIVATE_KEY,
    version: 1,
  };
}

function readStoredWallet(): LocalTestWallet | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(LOCAL_TEST_WALLET_KEY);
    return stored ? normalizeStoredWallet(JSON.parse(stored)) : null;
  } catch {
    return null;
  }
}

function writeStoredWallet(wallet: LocalTestWallet): void {
  window.localStorage.setItem(LOCAL_TEST_WALLET_KEY, JSON.stringify(wallet));
}

function shouldCreateWalletForCurrentSurface(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const surface = new URL(window.location.href).searchParams.get("surface");
    return (
      surface === "test" ||
      window.localStorage.getItem(AUTH_SURFACE_KEY) === "test" ||
      window.sessionStorage.getItem(AUTOLOGIN_KEY) === "test"
    );
  } catch {
    return false;
  }
}

export function createLocalTestWallet(): LocalTestWallet {
  if (!isLocalTestAuthAllowed()) {
    throw new Error("Local test wallet mode is only available on localhost in development.");
  }

  const configured = readConfiguredWallet();
  if (configured) {
    writeStoredWallet(configured);
    return configured;
  }

  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const wallet: LocalTestWallet = {
    address: getAddress(account.address),
    createdAt: new Date().toISOString(),
    privateKey,
    version: 1,
  };

  writeStoredWallet(wallet);
  return wallet;
}

export function ensureLocalTestWallet(): LocalTestWallet {
  if (!isLocalTestAuthAllowed()) {
    throw new Error("Local test wallet mode is only available on localhost in development.");
  }

  const configured = readConfiguredWallet();
  if (configured) {
    writeStoredWallet(configured);
    return configured;
  }

  const existing = readStoredWallet();
  if (existing) {
    return existing;
  }

  return createLocalTestWallet();
}

export function getLocalTestWalletAddress(): Address {
  if (!isLocalTestAuthAllowed()) {
    return DEFAULT_LOCAL_TEST_ADDRESS;
  }

  const configured = readConfiguredWallet();
  if (configured) {
    writeStoredWallet(configured);
    return configured.address;
  }

  const existing = readStoredWallet();
  if (existing) {
    return existing.address;
  }

  if (shouldCreateWalletForCurrentSurface()) {
    return createLocalTestWallet().address;
  }

  return DEFAULT_LOCAL_TEST_ADDRESS;
}
