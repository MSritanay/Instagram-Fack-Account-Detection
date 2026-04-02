import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import morgan from "morgan";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { PythonShell } from 'python-shell';
import path from 'path';
import cron from 'node-cron';
import authRouter from './routes/auth';
import { serveStatic } from '../static';
import instagramRouter from './routes/instagram'; // Import the new router
import analysisRouter from './routes/analysis';
import logRouter from '../routes/log';

const app = express();
const port = 5001;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(bodyParser.json());
app.use(morgan("dev"));

app.use('/api/auth', authRouter);
serveStatic(app);
app.use('/api/instagram', instagramRouter); // Use the new router
app.use('/api/analysis', analysisRouter);

import logger from './logger';

// Schedule a cron job to clean up message_analyses table every Sunday at midnight
cron.schedule('0 0 * * 0', async () => {
    logger.info('Running weekly cleanup of message_analyses table...');
    try {
        await db.delete(db.schema.message_analyses);
        logger.info('Message analyses table cleaned up successfully.');
    } catch (error) {
        logger.error('Error cleaning up message analyses table:', error);
    }
});

app.get("/", (req, res) => {
  res.send("Hello from the Instagram Authentication server!");
});

app.get("/api/profile-analyses", async (req, res) => {
  try {
    const analyses = await db.select().from(db.schema.profile_analyses);
    // attempt to extract heuristics stored in account_type
    const enriched = analyses.map(a => {
      const copy = { ...a };
      if (typeof copy.account_type === 'string' && copy.account_type.includes('heuristics:')) {
        const parts = copy.account_type.split('heuristics:');
        copy.account_type = parts[0].trim();
        try {
          copy.heuristics = JSON.parse(parts[1]);
        } catch {
          copy.heuristics = null;
        }
      }
      return copy;
    });
    res.json(enriched);
  } catch (error) {
    logger.error("Error fetching profile analyses:", error);
    res.status(500).json({ error: "Failed to fetch profile analyses" });
  }
});

app.post("/api/profile-analyses", async (req, res) => {
  const {
    userId,
    profile_pic,
    nums_length_username,
    fullname_words,
    nums_length_fullname,
    name_equals_username,
    description_length,
    external_URL,
    private,
    posts,
    followers,
    follows,
    username,
    reels,
    bio,
    accountType
  } = req.body;

  logger.info("--- Raw Scraped Data ---");
  logger.info("Bio:", bio);
  logger.info("Reels Count:", reels);
  logger.info("------------------------");

  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  try {
    // Check if user exists, if not create one
    const userExists = await db.select().from(db.schema.users).where(eq(users.id, userId));
    if (userExists.length === 0) {
      await db.insert(db.schema.users).values({
        id: userId,
        username: `user_${userId}`,
        email: `user_${userId}@example.com`,
      });
    }
  } catch (error) {
    logger.error("Error checking or creating user:", error);
    return res.status(500).json({ error: "Failed to check or create user" });
  }

  const pythonPath = process.platform === 'win32'
  ? path.join(__dirname, '..', '..', 'vir', 'Scripts', 'python.exe')
  : path.join(__dirname, '..', '..', 'vir', 'bin', 'python');

  const options = {
    mode: 'json',
    pythonPath: pythonPath,
    scriptPath: path.join(__dirname, '..', 'ml'),
    args: [JSON.stringify({
      'profile pic': profile_pic,
      'nums/length username': nums_length_username,
      'fullname words': fullname_words,
      'nums/length fullname': nums_length_fullname,
      'name==username': name_equals_username,
      'description length': description_length,
      'external URL': external_URL,
      'private': private,
      '#posts': posts,
      '#followers': followers,
      '#follows': follows,
    })]
  };

  try {
    const pyShell = new PythonShell('predict.py', options);
    let predictionResult: any;
    let pythonError = '';

    pyShell.on('message', function (message) {
      predictionResult = message;
    });

    pyShell.on('stderr', function (stderr) {
      pythonError += stderr;
    });

    await new Promise<void>((resolve, reject) => {
      pyShell.end(function (err) {
        if (err) {
          pythonError = err.message + (pythonError || '');
          reject(err);
        } else if (pythonError) {
          reject(new Error(pythonError));
        } else {
          resolve();
        }
      });
    });

    if (!predictionResult) {
      throw new Error('No prediction result from Python script.');
    }
    
    const prediction = predictionResult.prediction;
    const status = prediction === 1 ? 'Bot' : 'Human';

    const newAnalysis = await db
      .insert(db.schema.profile_analyses)
      .values({
        user_id: userId,
        profile_username: username,
        posts_count: posts,
        followers_count: followers,
        following_count: follows,
        reels_count: reels,
        bio: bio,
        has_profile_pic: profile_pic,
        account_type: accountType,
        is_private: private,
        status,
      })
      .returning();

    res.status(201).json(newAnalysis);
  } catch (error) {
    logger.error("Error during prediction or database insertion:", error);
    if (error instanceof Error) {
        logger.error("PythonShell Error:", error.message);
    }
    res.status(500).json({ 
      error: "Failed to get prediction or save profile analysis",
      pythonError: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("/api/message-analyses", async (req, res) => {
    try {
        const analyses = await db.select().from(db.schema.message_analyses);
        const enriched = analyses.map(a => {
            const copy = { ...a };
            if (typeof copy.risk_factors === 'string' && copy.risk_factors.includes('heuristics:')) {
                const parts = copy.risk_factors.split('heuristics:');
                copy.risk_factors = parts[0].trim();
                try {
                    copy.heuristics = JSON.parse(parts[1]);
                } catch {
                    copy.heuristics = null;
                }
            }
            return copy;
        });
        res.json(enriched);
    } catch (error) {
        logger.error("Error fetching message analyses:", error);
        res.status(500).json({ error: "Failed to fetch message analyses" });
    }
});

app.post("/api/message-analyses", async (req, res) => {
    const { userId, profile_username, risk_factors, prediction } = req.body;

    if (!userId || !profile_username) {
        return res.status(400).json({ error: "userId and profile_username are required" });
    }

    try {
        const newAnalysis = await db
            .insert(db.schema.message_analyses)
            .values({
                user_id: userId,
                profile_username: profile_username,
                risk_factors: JSON.stringify(risk_factors),
                prediction: prediction,
            })
            .returning();

        res.status(201).json(newAnalysis);
    } catch (error) {
        logger.error("Error saving message analysis:", error);
        res.status(500).json({ error: "Failed to save message analysis" });
    }
});

// Helper function to count numbers in a string
const countDigits = (str: string) => (str.match(/\d/g) || []).length;



app.post("/predict", async (req, res) => {
  try {
    const {
      username,
      fullName,
      bio,
      hasProfilePic,
      private: isPrivate,
      externalUrl,
      posts,
      followers,
      following,
    } = req.body;

    // 1. Feature Engineering
    const features = {
      'profile pic': hasProfilePic ? 1 : 0,
      'nums/length username': username && String(username).length > 0 ? countDigits(String(username)) / String(username).length : 0,
      'fullname words': fullName ? String(fullName).split(' ').filter(w => w.length > 0).length : 0,
      'nums/length fullname': fullName && String(fullName).length > 0 ? countDigits(String(fullName)) / String(fullName).length : 0,
      'name==username': fullName === username ? 1 : 0,
      'description length': bio ? String(bio).length : 0,
      'external URL': externalUrl ? 1 : 0,
      'private': isPrivate ? 1 : 0,
      '#posts': posts || 0,
      '#followers': followers || 0,
      '#follows': following || 0,
    };

    // 2. Python Shell setup
    const pythonPath = process.platform === 'win32'
      ? path.join(__dirname, '..', '..', 'vir', 'Scripts', 'python.exe')
      : path.join(__dirname, '..', '..', 'vir', 'bin', 'python');

    const options = {
      mode: 'json',
      pythonPath: pythonPath,
      scriptPath: path.join(__dirname, '..', 'ml'),
      args: [JSON.stringify(features)]
    };

    // 3. Run prediction script
    const pyShell = new PythonShell('predict.py', options);
    let predictionResult: any;
    let pythonError = '';

    pyShell.on('message', function (message) {
      predictionResult = message;
    });

    pyShell.on('stderr', function (stderr) {
      pythonError += stderr;
    });

    await new Promise<void>((resolve, reject) => {
      pyShell.end(function (err) {
        if (err) {
          pythonError = err.message + (pythonError || '');
          reject(err);
        } else if (pythonError) {
          reject(new Error(pythonError));
        } else {
          resolve();
        }
      });
    });

    if (!predictionResult) {
      throw new Error('No prediction result from Python script.');
    }

    const prediction = predictionResult.prediction;

    // 5. Save to database
    try {
      const status = prediction === 1 ? 'Bot' : 'Human';
      await db
        .insert(profile_analyses)
        .values({
          user_id: req.body.userId, // Make sure userId is passed from the client
          profile_username: username,
          posts_count: posts,
          followers_count: followers,
          following_count: following,
          reels_count: req.body.reels, // Make sure reels is passed
          bio: bio,
          has_profile_pic: hasProfilePic,
          account_type: status, // Store the predicted status
          is_private: isPrivate,
          status,
        });
      logger.info('Profile analysis saved to database.');
    } catch (dbError) {
      logger.error("Error saving profile analysis to database:", dbError);
      // We don't want to fail the whole request if only DB saving fails
      // But we should log it.
    }

    // 6. Send response
    res.status(200).json({ prediction });

  } catch (error) {
    logger.error("Error during prediction:", error);

    // Log the detailed error message from the Python script
    if (error instanceof Error) {
        logger.error("PythonShell Error:", error);
        // The 'message' property often contains the stderr output from the Python script
    }

    res.status(500).json({ 
      error: "Failed to get prediction",
      pythonError: error.message 
    });
  }
});

app.post("/api/log-client-error", (req, res) => {
  const { message, stack } = req.body;
  logger.error("--- CLIENT-SIDE ERROR ---");
  logger.error("Message:", message);
  logger.error("Stack:", stack);
  logger.error("-------------------------");
  res.sendStatus(200);
});

app.post("/api/log-client-message", (req, res) => {
  const { level, message, data } = req.body;
  const logData = data ? { message, data } : { message };
  logger[level](`--- CLIENT-SIDE ${level.toUpperCase()} ---`, logData);
  res.sendStatus(200);
});

import { log } from './logger';

app.listen(port, () => {
  log('API', 'Server Startup', 'SUCCESS', `Server listening on port ${port}`);
});
