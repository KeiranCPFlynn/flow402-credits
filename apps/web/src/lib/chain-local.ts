import { defineChain } from "viem";

export const anvil = defineChain({
    id: 31337,
    name: "Anvil Local",
    nativeCurrency: {
        decimals: 18,
        name: "ETH",
        symbol: "ETH",
    },
    rpcUrls: {
        default: { http: ["http://127.0.0.1:8545"] },
    },
});

