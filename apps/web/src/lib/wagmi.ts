import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { baseSepolia } from "wagmi/chains";
import { anvil } from "./chain-local";
import { DEPLOYMENT_RPC_URL } from "./treasury";

const chainEnv = process.env.NEXT_PUBLIC_CHAIN_ENV?.toLowerCase();
const isLocal = chainEnv === "local";
const isBaseFork = chainEnv === "base-fork";
const localRpcUrl = DEPLOYMENT_RPC_URL || "http://127.0.0.1:8545";
const configuredBaseRpc = process.env.NEXT_PUBLIC_BASE_RPC_URL;
const baseRpcUrl = isBaseFork ? localRpcUrl : configuredBaseRpc;

const transports = {
    [baseSepolia.id]: baseRpcUrl ? http(baseRpcUrl) : http(),
    [anvil.id]: http(localRpcUrl),
} as const;

const chains = [anvil, baseSepolia] as const;

export const primaryChain = isLocal ? anvil : baseSepolia;

export const wagmiConfig = createConfig({
    chains,
    transports,
    connectors: [
        injected({
            shimDisconnect: true,
        }),
    ],
    ssr: true,
});

export const availableTransports = transports;
export const isLocalChain = isLocal;
