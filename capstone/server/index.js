import { createApp } from './app.js';

const port = Number(process.env.PORT) || 4000;
const { server } = createApp();
server.listen(port, () => {
  console.log(`\n  SmartDMart API listening on http://localhost:${port}`);
  if (!process.env.ADMIN_PASSWORD && process.env.NODE_ENV !== 'production') {
    console.log('  Demo logins (change before publishing): admin / Admin@123   analyst / Analyst@123');
    console.log('  Set ADMIN_PASSWORD (and JWT_SECRET) environment variables for a real deployment.');
  }
  console.log('');
});
