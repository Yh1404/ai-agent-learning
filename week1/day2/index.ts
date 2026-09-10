import 'dotenv/config';
import OpenAI from 'openai';
import chalk from 'chalk';
import inquirer from 'inquirer';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';

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

const SYSTEM_PROMPT = '你是一个乐于助人的 AI 助手。当用户提出时间戳格式化请求时，必须调用 formatTimestamp 工具进行计算，不要直接心算或仅用文字描述计算过程AI助手。';

// 可用工具定义（parameters 用 JSON Schema 描述参数）
const TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'formatTimestamp',
      description: '将秒级时间戳格式化为YYYY-MM-DD HH:mm:ss',
      parameters: {
        type: 'object',
        description: '秒级时间戳',
        properties: {
            timestamp: {
                type: 'number',
                description: '秒级时间戳',
            },
        },
        required: ['timestamp'],
      },
    },
  },
];

const formatTimestamp = (time: number) => {
    const fullTime = time * 1000;
    const date = new Date(fullTime);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hour = date.getHours();
    const minute = date.getMinutes();
    const second = date.getSeconds();
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

// 执行工具，返回字符串结果（作为 tool 消息的 content）
function executeTool(name: string, argsJson: string): string {
  const args = JSON.parse(argsJson);
  if (name === 'formatTimestamp') {
    const time = args.timestamp as number;
    return formatTimestamp(time);
  }
  throw new Error(`未知工具：${name}`);
}

// 流式请求，累积文本与工具调用
interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string;
}

async function streamCompletion(
  model: string,
  messages: ChatCompletionMessageParam[],
  onText?: (text: string) => void,
): Promise<{ content: string; toolCalls: AccumulatedToolCall[] }> {
  const stream = await client.chat.completions.create({
    model,
    messages,
    tools: TOOLS,
    tool_choice: 'auto',
    stream: true,
  });

  let content = '';
  const toolCallsMap = new Map<number, AccumulatedToolCall>();

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;

    if (delta.content) {
      content += delta.content;
      onText?.(delta.content);
    }

    // 流式 tool_calls 是分片返回的，需要按 index 累积
    for (const tc of delta.tool_calls ?? []) {
      const current = toolCallsMap.get(tc.index) ?? { id: '', name: '', arguments: '' };
      if (tc.id) current.id = tc.id;
      if (tc.function?.name) current.name = tc.function.name;
      if (tc.function?.arguments) current.arguments += tc.function.arguments;
      toolCallsMap.set(tc.index, current);
    }
  }

  return { content, toolCalls: [...toolCallsMap.values()] };
}

async function chat(model: string) {
  // 维护完整对话历史，实现多轮对话
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];

  log(chalk.gray('输入 exit / quit 退出对话，输入 clear 清空上下文。1'));

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

    const startIndex = messages.length;
    messages.push({ role: 'user', content: text });

    try {
      // 工具调用闭环：模型可能连续调用多次工具，直到给出最终文本回答
      while (true) {
        let started = false;
        const { content, toolCalls } = await streamCompletion(model, messages, (t) => {
          if (!started) {
            process.stdout.write(chalk.green('AI: '));
            started = true;
          }
          process.stdout.write(t);
        });

        if (toolCalls.length === 0) {
          // 无工具调用：保存最终回答，结束本轮
          process.stdout.write('\n\n');
          messages.push({ role: 'assistant', content });
          break;
        }

        // 回填 assistant 消息（携带 tool_calls）
        messages.push({
          role: 'assistant',
          content: null,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.arguments },
          })),
        });

        // 逐个执行工具并回填结果
        for (const tc of toolCalls) {
          try {
            const result = executeTool(tc.name, tc.arguments);
            log(chalk.cyan(`调用工具 ${tc.name}(${tc.arguments}) → ${result}`));
            messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log(chalk.red(`工具执行失败：${msg}`));
            messages.push({ role: 'tool', tool_call_id: tc.id, content: `错误：${msg}` });
          }
        }
      }
    } catch (err) {
      messages.splice(startIndex); // 回滚本轮新增的所有消息
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
