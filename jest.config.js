module.exports = {
  roots: ['<rootDir>/src'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { diagnostics: false }],
  },
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  testPathIgnorePatterns: ['dist'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  testEnvironment: 'node',
  collectCoverage: true,
  collectCoverageFrom: [
    '<rootDir>/src/**/*.{js,ts,tsx}',
    '!<rootDir>/src/**/*.spec.ts',
  ],
  coverageReporters: ['html', 'lcov', 'text', 'text-summary'],
  setupFiles: [],
  setupFilesAfterEnv: []
};