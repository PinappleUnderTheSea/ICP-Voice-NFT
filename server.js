const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());  // 允许跨域请求

// 设置音频上传的存储路径，使用内存存储来快速测试
const storage = multer.memoryStorage();  // 文件保存在内存中，便于调试
const upload = multer({ storage });

// 模拟处理音频文件并返回固定的指纹值
app.post('/gen', upload.single('file'), (req, res) => {
  console.log('收到音频上传请求');

  if (!req.file) {
    console.error('未接收到文件');
    return res.status(400).send('没有文件上传');
  }

  // 输出上传文件的详细信息
  console.log('文件信息:');
  console.log('文件名:', req.file.originalname);
  console.log('文件大小:', req.file.size);
  console.log('文件类型:', req.file.mimetype);

  // 将文件内容输出到本地临时文件，便于调试
  const tempFilePath = path.join(__dirname, 'uploads', req.file.originalname);
  fs.writeFile(tempFilePath, req.file.buffer, (err) => {
    if (err) {
      console.error('保存音频文件失败:', err);
      return res.status(500).send('音频文件保存失败');
    }

    console.log('音频文件保存成功:', tempFilePath);

    // 模拟生成指纹并返回
    res.json({ voice_fingerprint: 500 });
  });
});

// 创建上传目录（如果不存在）
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
  console.log('创建上传目录:', uploadDir);
}

// 启动服务器
app.listen(8003, () => {
  console.log('服务器正在 http://127.0.0.1:8003 运行');
});

app.get('/', (req, res) => {
  res.send('Server is up and running!');
});

