import express from 'express';
import {
    fileURLToPath
} from 'url';
import {
    dirname,
    join
} from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

router.post('/chat', async (req, res) => {
    const {
        input
    } = req.body;
    if (!input) {
        return res.status(400).json({
            hata: 'Girdi gerekli'
        });
    }
    try {
        const response = await req.app.locals.agent.process(input);
        res.json(response);
    } catch (error) {
        res.status(500).json({
            hata: error.message
        });
    }
});

router.get('/history', (req, res) => {
    res.json(req.app.locals.agent.history);
});

router.get('/', (req, res) => {
    const filePath = join(__dirname, '../public/index.html');
    res.sendFile(filePath);
});

export default router;