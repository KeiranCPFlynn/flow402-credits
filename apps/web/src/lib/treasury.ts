import LocalDeployment from "@/contracts/deployment.local.json";
import BaseForkDeployment from "@/contracts/deployment.base-fork.json";
import Treasury from "@/contracts/Flow402Treasury.json";
import MockUSDC from "@/contracts/MockUSDC.json";

type DeploymentArtifact = typeof LocalDeployment;

const chainEnv = process.env.NEXT_PUBLIC_CHAIN_ENV?.toLowerCase();
const deploymentByEnv: Record<string, DeploymentArtifact> = {
    local: LocalDeployment,
    "base-fork": BaseForkDeployment,
};

const zeroAddress = "0x0000000000000000000000000000000000000000";
const hasValidAddresses = (artifact: DeploymentArtifact) =>
    artifact.treasury !== zeroAddress && artifact.usdc !== zeroAddress;

const fallbackDeployment = LocalDeployment;
const requestedDeployment = deploymentByEnv[chainEnv ?? ""] ?? fallbackDeployment;
const activeDeployment =
    hasValidAddresses(requestedDeployment) || requestedDeployment === fallbackDeployment
        ? requestedDeployment
        : fallbackDeployment;

export const DEPLOYMENT = activeDeployment;
export const TREASURY_ADDRESS = activeDeployment.treasury;
export const USDC_ADDRESS = activeDeployment.usdc;
export const VENDOR_ADDRESS = activeDeployment.vendor;

export const TREASURY_ABI = Treasury.abi;
export const USDC_ABI = MockUSDC.abi;

export const DEPLOYMENT_CHAIN_ID = activeDeployment.chainId;
export const DEPLOYMENT_RPC_URL = activeDeployment.rpcUrl;
