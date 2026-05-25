// Admin-curated P2P destination accounts. These are the phone numbers / bank
// accounts the system hands out to users when they start a P2P deposit. The
// admin panel would maintain this list; the runtime just picks a random
// available account per provider to distribute load and reduce fraud risk.
//
// Adding a new provider (e.g., another bank or wallet) is as simple as pushing
// a new entry to `p2pProviders` — the UI iterates the array dynamically.

export type P2PAccountType = "wallet" | "bank";

export interface P2PAccount {
  holderName: string;
  accountNumber: string; // phone number for wallet, account no for bank
  bankName?: string; // only for bank accounts
}

export interface P2PProvider {
  key: string;
  name: string;
  type: P2PAccountType;
  icon: string;
  // Time (minutes) the user should allow for admin confirmation after
  // submitting proof of payment.
  expectedConfirmMinutes: number;
  accounts: P2PAccount[];
}

export const p2pProviders: P2PProvider[] = [
  {
    key: "telebirr",
    name: "Telebirr",
    type: "wallet",
    icon: "https://ext.same-assets.com/1203561035/927399642.png",
    expectedConfirmMinutes: 10,
    accounts: [
      { holderName: "Abebe Bikila", accountNumber: "0911234567" },
      { holderName: "Kebede Alemu", accountNumber: "0922345678" },
      { holderName: "Tirunesh Dibaba", accountNumber: "0933456789" },
      { holderName: "Haile Gebrselassie", accountNumber: "0944567890" },
    ],
  },
  {
    key: "cbe",
    name: "CBE Bank",
    type: "bank",
    icon: "https://ext.same-assets.com/1203561035/927399642.png",
    expectedConfirmMinutes: 10,
    accounts: [
      {
        holderName: "Mulu Kassa",
        accountNumber: "1000123456789",
        bankName: "Commercial Bank of Ethiopia",
      },
      {
        holderName: "Selamawit Tesfaye",
        accountNumber: "1000234567890",
        bankName: "Commercial Bank of Ethiopia",
      },
      {
        holderName: "Yonas Birhanu",
        accountNumber: "1000345678901",
        bankName: "Commercial Bank of Ethiopia",
      },
    ],
  },
  {
    key: "boa",
    name: "Abyssinia",
    type: "bank",
    icon: "https://ext.same-assets.com/1203561035/927399642.png",
    expectedConfirmMinutes: 10,
    accounts: [
      {
        holderName: "Helen Abebe",
        accountNumber: "000456789012",
        bankName: "Bank of Abyssinia",
      },
      {
        holderName: "Dawit Mengesha",
        accountNumber: "000567890123",
        bankName: "Bank of Abyssinia",
      },
    ],
  },
  {
    key: "awash",
    name: "Awash Bank",
    type: "bank",
    icon: "https://ext.same-assets.com/1203561035/927399642.png",
    expectedConfirmMinutes: 10,
    accounts: [
      {
        holderName: "Senait Gebre",
        accountNumber: "0130987654321",
        bankName: "Awash Bank",
      },
      {
        holderName: "Daniel Asfaw",
        accountNumber: "0131098765432",
        bankName: "Awash Bank",
      },
    ],
  },
];

export function pickRandomAccount(provider: P2PProvider): P2PAccount {
  const list = provider.accounts;
  if (list.length === 0) {
    throw new Error("No P2P accounts configured for provider");
  }
  const rand = new Uint32Array(1);
  crypto.getRandomValues(rand);
  return list[rand[0] % list.length];
}

export function getProviderByKey(key: string): P2PProvider | undefined {
  return p2pProviders.find((p) => p.key === key);
}
