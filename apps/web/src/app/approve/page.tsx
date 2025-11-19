import ApproveClient from "./ApproveClient";

type PageProps = {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const ensureString = (value: string | string[] | undefined) => {
    if (Array.isArray(value)) {
        return value[0];
    }
    return value;
};

export default async function ApprovePage({ searchParams }: PageProps) {
    const params = await searchParams;

    const amount = ensureString(params.amount) ?? "10";
    const spendingLimit = ensureString(params.spendingLimit) ?? amount;
    const userId = ensureString(params.userId) ?? null;

    return (
        <ApproveClient
            amount={amount}
            spendingLimit={spendingLimit}
            userId={userId}
        />
    );
}

