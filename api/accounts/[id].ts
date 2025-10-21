
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  switch (req.method) {
    case 'GET':
      try {
        const accounts = await prisma.account.findMany();
        return res.status(200).json(accounts);
      } catch (error) {
        console.error('GET /api/accounts error:', error);
        return res.status(500).json({ error: 'Failed to fetch accounts' });
      }

    case 'POST': {
      const { account_name, account_number, bank, type, balance, status } = req.body;

      if (
        !account_name ||
        !account_number ||
        !type ||
        !status ||
        balance === undefined
      ) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      try {
        const newAccount = await prisma.account.create({
          data: {
            account_name,
            account_number,
            type,
            status,
            balance: parseFloat(balance),
            bank: bank || '',
          },
        });

        return res.status(201).json(newAccount);
      } catch (error) {
        console.error('POST /api/accounts error:', error);
        return res.status(500).json({ error: 'Failed to create account' });
      }
    }

    default:
      res.setHeader('Allow', ['GET', 'POST']);
      return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
