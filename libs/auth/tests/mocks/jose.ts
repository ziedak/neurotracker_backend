// Mock for jose library
export const SignJWT = jest.fn().mockReturnValue({
  setProtectedHeader: jest.fn().mockReturnThis(),
  setIssuedAt: jest.fn().mockReturnThis(),
  setExpirationTime: jest.fn().mockReturnThis(),
  setSubject: jest.fn().mockReturnThis(),
  sign: jest.fn().mockResolvedValue("mock.jwt.token"),
});

export const jwtVerify = jest.fn().mockResolvedValue({
  payload: {
    sub: "test-user-id",
    email: "test@example.com",
    exp: Math.floor(Date.now() / 1000) + 3600,
  },
});

export const JWTPayload = {};

export const decodeJwt = jest.fn().mockReturnValue({
  sub: "test-user-id",
  email: "test@example.com",
  exp: Math.floor(Date.now() / 1000) + 3600,
});

export const createRemoteJWKSet = jest.fn();
export const importJWK = jest.fn();
export const exportJWK = jest.fn();
