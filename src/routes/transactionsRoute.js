import express from "express";

import { createTransaction, deleteTransaction, getSummaryByUserID, getTransactionsByUserId } from "../controllers/transactionsController.js";
const router = express.Router();

router.get("/:userId", getTransactionsByUserId);
router.post("/", createTransaction);
router.delete("/:id", deleteTransaction);
router.get("/summary/:userId", getSummaryByUserID);

export default router;