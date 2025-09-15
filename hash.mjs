import bcrypt from 'bcryptjs';
console.log(bcrypt.hashSync('123456', 10));
