import * as readline from 'readline';
import { runAgent } from './agent.js'; // Note the .js extension for ESM resolution in Node

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

let conversationHistory: any[] = [];

console.log('🌼 Welcome to the Daisy Amenity Reservation System!');
console.log('You can ask to book the pool or the BBQ grill.');
console.log('Type "exit" or "quit" to leave.\n');

const promptUser = () => {
  rl.question('You: ', async (input) => {
    const trimmed = input.trim();
    if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
      console.log('Goodbye!');
      rl.close();
      return;
    }

    if (!trimmed) {
      promptUser();
      return;
    }

    process.stdout.write('\n🌼 Daisy is thinking...\n');
    
    // We pass history to runAgent, which returns the updated text and new history array
    const { text, history } = await runAgent(trimmed, conversationHistory);
    
    conversationHistory = history;

    console.log(`\n🌼 Daisy: \x1b[36m${text}\x1b[0m\n`); // Cyan color for assistant response
    
    promptUser();
  });
};

// Start the loop
promptUser();
