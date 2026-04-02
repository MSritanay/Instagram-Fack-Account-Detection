import express from 'express';
import { log } from '../logger';

const router = express.Router();

router.post('/', (req, res) => {
    const { module, action, status, message, error } = req.body;

    if (!module || !action || !status || !message) {
        return res.status(400).send('Missing required log fields.');
    }

    log(module, action, status, message, error);

    res.status(200).send('Log received.');
});

export default router;