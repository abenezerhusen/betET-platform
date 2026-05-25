import { getRegisteredPaths } from './registry';

const swaggerSpec = {
  openapi: '3.0.0',
  info: {
    title: 'PlayCore API',
    version: '1.0.0',
    description:
      'Betting platform API — Admin, User, Cashier, P2P, Games',
  },
  servers: [{ url: 'http://localhost:4000', description: 'Local development' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: getRegisteredPaths(),
};

export default swaggerSpec;
