const { neon } = require('@neondatabase/serverless');
require('dotenv').config();
const db = neon(process.env.DATABASE_URL);
db('SELECT table_name FROM information_schema.tables WHERE table_schema = \'public\'').then(res => console.log(res.map(r => r.table_name).join(', ')));
