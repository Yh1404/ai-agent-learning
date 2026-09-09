## 2026 9.9深夜

`今天开始学习agent工程师的一些内容，因为之前已经学过一些基础内容，所以今天直接开始动手做了一个ai对话cli，支持选择模型和多轮对话。`

### 总结：
1.使用chalk库来打印不同样式的终端文本，chalk库的主要特点是支持链式调用，例如：
```typescript
log(chalk.yellow('hello world').green('world'))
```

2.使用inquirer库来获取用户输入，inquirer库支持多种类型的用户输入，例如input、password、select等：
```typescript
  const { model } = await inquirer.prompt<{ model: string }>([
    {
      type: 'select',
      name: 'model',
      message: '选择模型',
      choices: MODELS,
    },
  ]);
```
3.多轮对话，实现多轮对话的关键在于while循坏和维护一个messages数组。

- 通过while循环来获取用户输入，然后判断是否是退出命令，如果是退出命令，则退出循环。
- 将每次用户的输入和ai的回复都添加到messages数组中即可，另外还可以补充一些role为system的提示信息：

```typescript
  const messages = [];
  messages.push({ role: 'system', content: '你好，我是ai' });

```
