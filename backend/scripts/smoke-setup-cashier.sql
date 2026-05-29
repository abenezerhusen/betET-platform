-- Configure the seeded cashier so the new branch-required login works.
-- The login service accepts a match against ANY of branch_code /
-- branch_id (UUID) / branch_user_id, so we set branch_code='PC001' and
-- DROP the bogus string branch_id so getBranchForCashier doesn't try
-- to cast it to UUID.
UPDATE users
   SET metadata = (metadata - 'branch_id') || jsonb_build_object('branch_code','PC001')
 WHERE email = 'cashier@playcore.local'
RETURNING id, email, role, metadata;
