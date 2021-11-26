const config = {
  withdraw: {
    minEarnedToWithdraw: 200,
  },
  database: {
    host: 'localhost',
    user: 'root',
    password: process.env.DB_Password || '',
    database: process.env.DB_Name || '',
  }
};

module.exports = config;
