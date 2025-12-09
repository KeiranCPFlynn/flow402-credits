"use client";

import type { Address } from "viem";
import { readContract, writeContract, waitForTransactionReceipt } from "wagmi/actions";
import { TREASURY_ABI, TREASURY_ADDRESS, USDC_ABI, USDC_ADDRESS } from "./treasury";
import { wagmiConfig } from "./wagmi";

const treasuryAddress = TREASURY_ADDRESS as Address;
const usdcAddress = USDC_ADDRESS as Address;

export async function checkAllowance(owner: Address): Promise<bigint> {
    const value = await readContract(wagmiConfig, {
        address: usdcAddress,
        abi: USDC_ABI,
        functionName: "allowance",
        args: [owner, treasuryAddress],
    });

    return value as bigint;
}

export async function approveUSDC(amount: bigint) {
    const hash = await writeContract(wagmiConfig, {
        address: usdcAddress,
        abi: USDC_ABI,
        functionName: "approve",
        args: [treasuryAddress, amount],
    });

    await waitForTransactionReceipt(wagmiConfig, { hash });
    return hash;
}

export async function deposit(amount: bigint, spendingLimit: bigint) {
    const hash = await writeContract(wagmiConfig, {
        address: treasuryAddress,
        abi: TREASURY_ABI,
        functionName: "deposit",
        args: [amount, spendingLimit],
    });

    await waitForTransactionReceipt(wagmiConfig, { hash });
    return hash;
}

export async function depositFor(vendor: Address, amount: bigint, spendingLimit?: bigint) {
    void vendor;
    const limit = spendingLimit ?? amount;
    return deposit(amount, limit);
}
