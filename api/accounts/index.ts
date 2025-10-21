
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';

const handleGetAccounts = async (res: NextApiResponse) => {
  try {
    const accounts = await prisma.account.findMany();
    return res.status(200).json(accounts);
  } catch (error) {
    console.error('GET /api/accounts error:', error);
    return res.status(500).json({ error: 'Failed to fetch accounts' });
  }
};

const handleCreateAccount = async (req: NextApiRequest, res: NextApiResponse) => {
  const {
    accountName,
    accountNumber,
    bankName,
    accountType,
    balance,
    currency,
    openingDate,
    status,
    branchCode,
    swiftCode,
    description,
  } = req.body;

  if (
    !accountName ||
    !accountNumber ||
    !bankName ||
    !accountType ||
    !currency ||
    balance === undefined ||
    !openingDate ||
    !status
  ) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const newAccount = await prisma.account.create({
      data: {
        accountName,
        accountNumber,
        bankName,
        accountType,
        currency,
        balance: parseFloat(balance),
        openingDate: new Date(openingDate),
        status,
        branchCode,
        swiftCode,
        description,
      },
    });

    return res.status(201).json(newAccount);
  } catch (error) {
    console.error('POST /api/accounts error:', error);
    return res.status(500).json({ error: 'Failed to create account' });
  }
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const method = req.method;

  switch (method) {
    case 'GET':
      return await handleGetAccounts(res);
    case 'POST':
      return await handleCreateAccount(req, res);
    default:
      res.setHeader('Allow', ['GET', 'POST']);
      return res.status(405).end(`Method ${method} Not Allowed`);
  }
}
