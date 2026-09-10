import 'dotenv/config';
import OpenAI from 'openai';
import chalk from 'chalk';
import inquirer from 'inquirer';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

const log = console.log;

const apiKey = process.env.DEEPSEEK_API_KEY;
const baseURL = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com';

if (!apiKey) {
  log(chalk.red('未检测到 DEEPSEEK_API_KEY，请在 .env 文件中配置后重试。'));
  process.exit(1);
}

const client = new OpenAI({ apiKey, baseURL });

// 可选模型列表
const MODELS = [
  { name: 'DeepSeek V4 Pro', value: 'deepseek-v4-pro' },
  { name: 'DeepSeek V4 Flash', value: 'deepseek-v4-flash' },
];

const SYSTEM_PROMPT = '你是一个乐于助人的 AI 助手。';

async function chat(model: string) {
  // 维护完整对话历史，实现多轮对话
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];

  log(chalk.gray('输入 exit / quit 退出对话，输入 clear 清空上下文。'));

  while (true) {
    const { question } = await inquirer.prompt<{ question: string }>([
      { type: 'input', name: 'question', message: '你' },
    ]);

    const text = question.trim();
    if (!text) continue;

    const command = text.toLowerCase();
    if (command === 'exit' || command === 'quit') {
      log(chalk.yellow('再见！'));
      break;
    }
    if (command === 'clear') {
      messages.splice(1); // 只保留 system 消息
      log(chalk.gray('上下文已清空。'));
      continue;
    }

    messages.push({ role: 'user', content: text });

    try {
      const stream = await client.chat.completions.create({
        model,
        messages,
        stream: true,
      });

      let answer = '';
      process.stdout.write(chalk.green('AI: '));
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? '';

        if (delta) {
          answer += delta;
          process.stdout.write(delta);
        }
      }
      process.stdout.write('\n\n');

      messages.push({ role: 'assistant', content: answer });
    } catch (err) {
      messages.pop();
      log(chalk.red('请求失败：'), err instanceof Error ? err.message : String(err));
    }
  }
}

async function main() {
  const { model } = await inquirer.prompt<{ model: string }>([
    {
      type: 'select',
      name: 'model',
      message: '选择模型',
      choices: MODELS,
    },
  ]);

  log(chalk.green(`已选择模型：${model}`));
  await chat(model);
}

main().catch((err) => {
  log(chalk.red('程序异常退出：'), err instanceof Error ? err.message : String(err));
  process.exit(1);
});
