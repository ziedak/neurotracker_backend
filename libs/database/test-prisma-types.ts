import { Prisma } from '@prisma/client';

// Test what fields are in UserSessionCreateInput
type Test = Prisma.UserSessionCreateInput;

// Test what fields are in UserSessionUncheckedCreateInput
type TestUnchecked = Prisma.UserSessionUncheckedCreateInput;

// This will show us the actual types
const test: Test = {
  user: { connect: { id: 'test' } }
};

const testUnchecked: TestUnchecked = {
  userId: 'test',
  accountId: 'account-id' // This should work if accountId is in schema
};
