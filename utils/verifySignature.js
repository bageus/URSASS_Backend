const ethers = require('ethers');

/**
 * ✅ Верифицирует EIP-191 подпись
 * @param {string} message - Исходное сообщение (то же, что подписывали на фронтенде)
 * @param {string} signature - Подпись (0x-строка)
 * @param {string} wallet - Адрес кошелька
 * @returns {boolean} - true если подпись корректна
 */
function verifySignature(message, signature, wallet) {
  try {
    // ✅ Восстанавливаем адрес из подписи
    const recoveredAddress = ethers.utils.verifyMessage(message, signature);
    
    // ✅ Сравниваем с адресом кошелька (в lowercase для надёжности)
    return recoveredAddress.toLowerCase() === wallet.toLowerCase();
  } catch(error) {
    console.error('❌ Ошибка верификации подписи:', error.message);
    return false;
  }
}

/**
 * ✅ Формирует сообщение для верификации (должно совпадать с фронтендом!)
 * @param {string} wallet - Адрес кошелька
 * @param {number} score - Результат
 * @param {number} distance - Расстояние
 * @param {number} timestamp - Timestamp
 * @returns {string} - Сообщение для верификации
 */
function createMessageToVerify(wallet, score, distance, timestamp) {
  return `Save game result\nWallet: ${wallet}\nScore: ${Math.floor(score)}\nDistance: ${Math.floor(distance)}\nTimestamp: ${timestamp}`;
}

module.exports = {
  verifySignature,
  createMessageToVerify
};
