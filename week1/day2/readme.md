## 2026.9.10晚

今天看了Tool Calling的原理，并在昨天的agent cli的基础上做了demo，简单来说，在构建agent时需要记住一个总纲领，LLM是以自然语言为接口，不管是Tool Calling还是MCP等工具，本质都是使用自然语言与LLM对话。

Tool Calling流程

agent将可用的工具列表传递给LLM，LLM根据问题自主决定是否使用Tool，当LLM需要使用Tool时，agent应该准备好相应的工具实现。最后将工具生成的结果回传给LLM，LLM将工具结果包装后返回最终答案。

1. 将ToolList传递给LLM。

 OpenAI的SDK支持在创建对话时传入tools，只需要按照规定的范式把tools工具传递给LLM
 ```typescript
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

  const stream = await client.chat.completions.create({
    model,
    messages,
    tools: TOOLS,
    tool_choice: 'auto', // 模型自主抉择使用Tool
    stream: true,
  });
 ```
2. 解析LLM返回的工具调用，并创建ToolCallingMap集中管理
 ```typescript
     // 流式 tool_calls 是分片返回的，需要按 index 累积
    for (const tc of delta.tool_calls ?? []) {
      const current = toolCallsMap.get(tc.index) ?? { id: '', name: '', arguments: '' };
      if (tc.id) current.id = tc.id;
      if (tc.function?.name) current.name = tc.function.name;
      if (tc.function?.arguments) current.arguments += tc.function.arguments;
      toolCallsMap.set(tc.index, current);
    }
 ```

3. 执行工具调用
```typescript
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
```