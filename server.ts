import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import documentsRouter from "./api/admin/documents/all/route";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Root route
app.get("/", (req: Request, res: Response) => {
  res.send("Backend is running 🚀");
});

// Mount documents route
app.use("/api/admin/documents", documentsRouter);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
