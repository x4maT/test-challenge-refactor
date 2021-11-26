const withdraw = require('./withdraw');

module.exports = (socket) => {
  let socketuser = socket.request.user;
  // Socketuser is false if the user is not logged in
  if (socketuser.logged_in == false) socketuser = false;

  socket.on('onsiteGiftcardWithdraw', withdraw.onsiteGiftcardWithdraw(socket, socketuser));
};
