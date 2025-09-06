import express from "express";
import dotenv from "dotenv";
import { initDB } from "./config/db.js"; 
import rateLimiter from "./middleware/rateLimiter.js";
import transactionsRoute from "./routes/transactionsRoute.js";
import job from "./config/cron.js";

// Start the cron job
if (process.env.NODE_ENV === "production") job.start();

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

app.get("/api/health", (req, res) => {
    res.status(200).send({ status: "ok" });
});
app.use("/api/transactions", transactionsRoute);

app.use(rateLimiter);
app.use(express.json());


initDB().then(() => {
    app.listen(PORT, () => {
        console.log("Server is running on port", PORT);
    });
});
