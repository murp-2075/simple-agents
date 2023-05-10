import env from "dotenv";
env.config();

import fs from "fs";
import { Parser } from "expr-eval";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
const rl = readline.createInterface({ input, output });

const promptTemplate = fs.readFileSync("prompt.txt", "utf8");
const mergeTemplate = fs.readFileSync("merge.txt", "utf8");

// use serpapi to answer the question
const googleSearch = async (question) =>
    await fetch(
        `https://serpapi.com/search?api_key=${process.env.SERPAPI_API_KEY}&q=${question}`
    )
        .then((res) => res.json())
        .then(
            (res) =>
                // try to pull the answer from various components of the response
                res.answer_box?.answer ||
                res.answer_box?.snippet ||
                res.organic_results?.[0]?.snippet
        );

// tools that can be used to answer questions
const tools = {
    search: {
        description:
            "a search engine. useful for when you need to answer questions about current events. input should be a search query.",
        execute: googleSearch,
    },
    calculator: {
        description:
            "Useful for getting the result of a math expression. The input to this tool should be a valid mathematical expression that could be executed by a simple calculator.",
        execute: (input) => Parser.evaluate(input).toString(),
    },
};

// use GPT-3.5 to complete a given prompts
const completePrompt = async (prompt) =>
    await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + process.env.OPENAI_API_KEY,
        },
        body: JSON.stringify({
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 256,
            temperature: 0.7,
            stream: false,
            stop: ["Observation:"],
        }),
    })
        .then((res) => res.json())
        .then((res) =>
            res.choices[0].message.content
        )
        .then((res) => {
            console.log("\x1b[91m" + prompt + "\x1b[0m");
            console.log("\x1b[92m" + res + "\x1b[0m");
            return res;
        });

const answerQuestion = async (question) => {
    // construct the prompt, with our question and the tools that the chain can use
    let prompt = promptTemplate.replace("${question}", question).replace(
        "${tools}",
        Object.keys(tools)
            .map((toolname) => `${toolname}: ${tools[toolname].description}`)
            .join("\n")
    );

    // allow the LLM to iterate until it finds a final answer
    while (true) {
        const response = await completePrompt(prompt);

        // add this to the prompt
        prompt += response;

        const action = response.match(/Action: (.*)/)?.[1];
        if (action) {
            console.log(`Doing action: ${action}`);
            // execute the action specified by the LLMs
            const actionInput = response.match(/Action Input: "?(.*)"?/)?.[1];
            const result = await tools[action.trim()].execute(actionInput);
            console.log(`Doing action: ${action} with input: ${actionInput} and got result: ${result}`);
            prompt += `Observation: ${result}\n`;
        } else {
            return response.match(/Final Answer: (.*)/)?.[1];
        }
    }
};

// merge the chat history with a new question
const mergeHistory = async (question, history) => {
    const prompt = mergeTemplate
        .replace("${question}", question)
        .replace("${history}", history);
    return await completePrompt(prompt);
};

// main loop 
let history = "";
while (true) {
    let question = await rl.question("How can I help? ");
    if (history.length > 0) {
        question = await mergeHistory(question, history);
    }
    const answer = await answerQuestion(question);
    console.log(answer);
    history += `Q:${question}\nA:${answer}\n`;
}