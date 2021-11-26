import Withdraw from './withdraw';

export default (socket) => {
  const withdraw = new Withdraw(socket);

  socket.on('onsiteGiftcardWithdraw', withdraw.bindedGiftCardWithdrow);
};
