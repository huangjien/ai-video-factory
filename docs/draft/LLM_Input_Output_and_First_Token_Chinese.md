# AI 模型如何处理输入并生成输出：为什么第一个输出 Token 特别重要？

要理解 AI 模型如何处理输入并生成输出，可以从 Transformer
架构入手。GPT、Claude、GLM、MiniMax、DeepSeek
等现代大语言模型（LLM）大多采用 Transformer 或其变体。

最重要的概念是：

**生成第一个输出 Token，与生成第二个、第三个及后续
Token，是两个不同的计算阶段。**

第一个输出 Token
生成之前，模型必须处理完整的输入提示词（Prompt）。从第二个输出 Token
开始，模型通常可以通过 **KV Cache（键值缓存）** 复用前面已经完成的计算。

本文按照实际推理流程逐步解释。

------------------------------------------------------------------------

## 1. 整体推理流程

假设用户输入：

> What is 2 + 3? Explain briefly.

模型并不是直接理解字符串，而是先将文本转换为 Token，再将 Token
转换为向量，最后通过 Transformer 网络计算下一个 Token。

``` text
用户输入文本
    |
    v
Tokenization（分词）
    |
    v
Token IDs（Token 编号）
    |
    v
Embedding + Positional Information
（词嵌入和位置信息）
    |
    v
Transformer Layers
（Prefill：处理完整输入）
    |
    v
Logits / Probability Distribution
（计算下一个 Token 的分数和概率）
    |
    v
选择第一个输出 Token
    |
    v
Decode（逐 Token 生成后续内容）
```

整个过程可以分为两个核心阶段：

-   **Prefill（预填充）**：处理输入提示词，为生成做准备。
-   **Decode（解码）**：逐个生成输出 Token。

第一个输出 Token 必须等待 Prefill
完成，因此它的延迟通常明显受到输入长度影响。

------------------------------------------------------------------------

## 2. Prefill 阶段：模型如何处理输入？

假设输入被分成以下六个 Token：

``` text
Token 1: What
Token 2: is
Token 3: 2
Token 4: +
Token 5: 3
Token 6: ?
```

实际 Tokenizer
的切分结果取决于模型，不一定与单词边界完全一致。这里仅用于说明。

### 2.1 将 Token ID 转换为向量

每个 Token ID 会通过 Embedding 层映射为一个高维数值向量。

为了方便理解，假设每个 Token 只有 4 个维度：

  Token   示例 Embedding
  ------- ------------------------
  What    `[0.2, 0.5, 0.1, 0.8]`
  is      `[0.3, 0.1, 0.7, 0.4]`
  2       `[0.9, 0.2, 0.3, 0.1]`
  \+      `[0.1, 0.8, 0.2, 0.5]`
  3       `[0.7, 0.3, 0.4, 0.2]`
  ?       `[0.4, 0.6, 0.1, 0.9]`

真实模型的向量维度通常大得多，可能达到数千维。

模型还需要编码 Token 的位置信息，使其能够区分：

-   `A B` 和 `B A`
-   前面的 Token 和后面的 Token
-   不同位置之间的关系

现代 Transformer 常见的位置编码技术包括 RoPE（Rotary Positional
Embeddings，旋转位置编码）。

### 2.2 通过 Transformer Layers

这是模型执行主要计算的阶段。

一个典型的 Transformer 层主要包含两个部分：

1.  **Self-Attention（自注意力）**
2.  **Feed-Forward Network，FFN（前馈网络）**

这两个部分会在多个 Transformer 层中重复执行。

#### Self-Attention：理解上下文

Self-Attention 让每个 Token 根据前面的 Token 获取上下文信息。

例如，在因果注意力（Causal Attention）机制下：

  当前 Token   可以关注的 Token
  ------------ -------------------
  What         What
  is           What、is
  2            What、is、2
  \+           What、is、2、+
  3            What、is、2、+、3
  ?            整个输入序列

这种限制由 Causal
Mask（因果掩码）实现，确保模型不会在预测某个位置时看到未来 Token。

**一个容易忽略的细节：Prefill 阶段可以并行处理多个输入位置。**

虽然每个位置的注意力范围不同，但模型可以利用 GPU
并行计算这些位置，而不是像生成输出那样必须逐 Token 推进。

### 2.3 Q、K、V 是什么？

在 Attention 内部，模型会从隐藏状态计算三个表示：

-   **Q（Query，查询）**：当前 Token 想寻找什么信息？
-   **K（Key，键）**：每个 Token 提供什么信息索引？
-   **V（Value，值）**：每个 Token 实际提供什么信息？

常见的 Attention 计算公式是：

\[
Attention(Q,K,V)=Softmax`\left`{=tex}(`\frac{QK^T}{\sqrt{d_k}}`{=tex}`\right`{=tex})V
\]

可以粗略理解为：

1.  使用 Query 与各个 Key 计算相关性。
2.  通过 Softmax 得到注意力权重。
3.  根据权重对 Value 加权求和。
4.  得到融合上下文信息后的表示。

### 2.4 KV Cache 在哪里产生？

在每个 Transformer Attention 层中，模型会计算输入 Token 对应的 Key 和
Value 表示。

这些 K/V 表示可以被保存起来，供后续生成阶段使用，这就是 **KV Cache**。

例如，输入包含 6 个 Token：

``` text
What is 2 + 3 ?
```

Prefill 完成后，模型已经为这些输入位置计算了各层所需的 K/V 表示。

后续生成新 Token 时，就不必重新计算这些历史 Token 的 K/V 表示。

注意：KV Cache 通常包含每个 Attention
层的缓存，而不只是整个模型的一份简单缓存。

------------------------------------------------------------------------

## 3. 第一个输出 Token 是如何生成的？

这是整个推理流程中最值得理解的部分。

假设模型已经完成输入处理：

``` text
Input: What is 2 + 3?
```

模型会取最后一个输入位置（这里是
`?`）对应的最终隐藏状态，并将它投影到模型的词表空间。

### 3.1 从隐藏状态得到 Logits

假设模型词表中有 100,000 个候选 Token。

模型会为每个候选 Token 计算一个分数，这些分数称为 **Logits**。

例如：

  候选 Token     示例概率
  ------------ ----------
  `5`                 75%
  `The`               10%
  `2`                  5%
  `Answer`             4%
  其他 Token           6%

这些概率只是用于解释的示例，并非真实模型测量结果。

### 3.2 Softmax：将 Logits 转换为概率

模型通常使用 Softmax 将 Logits 转换为概率分布：

\[ P(token_i)=`\frac{e^{z_i}}{\sum_j e^{z_j}}`{=tex} \]

其中：

-   (z_i) 是候选 Token 的 Logit。
-   分母是所有候选 Token 的指数分数之和。
-   所有候选 Token 的概率之和为 1。

### 3.3 Decoding：选择第一个 Token

模型需要根据解码策略选择一个 Token。

#### Greedy Decoding（贪心解码）

直接选择概率最高的 Token。

``` text
5 = 75%
```

因此第一个输出 Token 是：

``` text
5
```

#### Sampling（采样）

模型也可以根据概率分布进行随机采样。

例如，即使 `5` 的概率最高，模型仍可能选中 `The`。

Temperature、Top-p 和 Top-k 等参数会影响采样行为：

-   **Temperature**：调整概率分布的平滑程度。
-   **Top-p**：只从累计概率达到指定阈值的候选集合中采样。
-   **Top-k**：只从概率最高的 K 个候选 Token 中采样。

因此，第一个输出 Token 的生成可以概括为：

``` text
完整输入
   |
   v
Transformer 处理
   |
   v
最后一个输入位置的 Hidden State
   |
   v
Vocabulary Projection
   |
   v
Logits
   |
   v
Softmax
   |
   v
Decoding Strategy
   |
   v
第一个输出 Token
```

**为什么第一个 Token 比较耗时？**

因为在它出现之前，模型必须完成完整输入的 Prefill 计算，包括：

1.  Token Embedding 和位置编码。
2.  所有 Transformer 层的计算。
3.  Attention 计算。
4.  最终隐藏状态的计算。
5.  Vocabulary Projection。
6.  Token 选择。

这也是为什么输入越长，通常越容易增加首 Token 延迟（TTFT）。

------------------------------------------------------------------------

## 4. 第二个输出 Token 是如何生成的？

假设模型已经生成第一个 Token：

``` text
Input:  What is 2 + 3?
Output: 5
```

模型接下来需要生成：

``` text
The answer is 5.
```

此时模型不需要重新处理完整的原始输入。

它可以利用 KV Cache：

1.  将刚生成的 Token 加入序列。
2.  将新 Token 转换为 Embedding。
3.  将新 Token 通过 Transformer 各层。
4.  使用之前保存的 KV Cache。
5.  计算下一个 Token 的概率分布。
6.  选择下一个 Token。

例如：

``` text
第一次生成：
输入：What is 2 + 3 ?
输出：5

第二次生成：
历史 KV Cache：What is 2 + 3 ?
新输入：5
输出：The

第三次生成：
历史 KV Cache：What is 2 + 3 ? 5
新输入：The
输出：answer
```

### 4.1 KV Cache 如何减少重复计算？

假设原始输入有 6 个 Token。

第一次生成完成后，模型已经拥有这 6 个位置的 KV Cache。

第二次生成时：

-   不需要重新计算原始 6 个 Token 的 K/V。
-   只需要为新 Token 计算新的 K/V。
-   新 Token 的 Query 仍然需要与历史 Key 进行 Attention。
-   最终得到下一个 Token 的 Logits。

第三次生成时继续重复这个过程。

因此，KV Cache 并不是完全消除历史上下文的计算，而是避免重复计算历史
Token 的 K/V 表示。

------------------------------------------------------------------------

## 5. 为什么第一个 Token 对性能如此重要？

现在可以区分两个重要的推理性能指标。

  指标   全称                  含义
  ------ --------------------- -----------------------------------------
  TTFT   Time To First Token   从请求开始到第一个输出 Token 出现的时间
  TPS    Tokens Per Second     模型生成 Token 的速度

假设有两个请求：

-   Prompt A：1,000 个输入 Token。
-   Prompt B：50,000 个输入 Token。

在相同模型、硬件和其他条件下，Prompt B 通常需要更多 Prefill
计算，因此第一个 Token 通常会更晚出现。

但是，在生成开始之后，两者的 Decode
速度可能比较接近。当然，较长的上下文也可能降低 Decode 速度，因为每个新
Token 都需要关注更多历史上下文。

### Prefill 与 Decode 的区别

  维度       Prefill                   Decode
  ---------- ------------------------- --------------------------
  处理对象   整个输入序列              每次一个新 Token
  并行程度   高                        低，具有自回归依赖
  主要计算   大量矩阵运算、Attention   单 Token 推理、Attention
  KV Cache   创建或填充                读取并追加
  性能关注   输入 Token 处理吞吐量     输出 Token 生成速度
  典型指标   Prefill tokens/s          Decode tokens/s

这也是为什么模型服务商有时会分别公布：

-   **Prefill Throughput**：模型处理输入 Token 的速度。
-   **Decode Throughput**：模型生成输出 Token 的速度。

它们是不同的计算负载，可以通过不同的硬件和软件优化。

------------------------------------------------------------------------

## 6. GPU 架构为什么会影响 Prefill 和 Decode？

理解 Prefill 与 Decode 的差异，也有助于理解 GPU 的性能。

  操作                    主要性能瓶颈
  ----------------------- ----------------------
  Embedding Lookup        内存访问
  Prefill                 计算吞吐量和内存带宽
  Attention               计算能力和内存带宽
  KV Cache 访问           内存带宽
  Decode                  经常受内存带宽限制
  Vocabulary Projection   计算和内存访问

### 为什么 Decode 经常受内存带宽限制？

在每次生成步骤中，GPU 需要访问模型权重以及历史 Attention 数据。

但是，每一步通常只生成一个新的 Token。

对于大型模型而言，GPU 可能需要读取大量权重，却只完成少量新 Token
的计算，因此内存带宽可能成为瓶颈。

Prefill 则可以一次处理大量输入 Token，使 GPU 更充分地利用并行计算单元。

所以：

**GPU 的 FLOPS（浮点运算能力）并不能单独决定 LLM 推理速度。**

还需要考虑：

-   显存容量。
-   显存带宽。
-   GPU 计算能力。
-   KV Cache 的大小。
-   Attention Kernel 的实现。
-   Batch Size 和并发请求数。
-   模型量化方式。

------------------------------------------------------------------------

## 7. 对 AI Agent 架构有什么影响？

假设你正在构建一个 DevOps MCP Agent，它有以下上下文：

  内容                     Token 数量
  ---------------------- ------------
  System Prompt                10,000
  MCP Tool Definitions          5,000
  Conversation History         20,000
  当前用户指令                  1,000
  **总计**                 **36,000**

模型在开始生成第一个输出 Token 之前，通常需要处理约 36,000 个输入
Token。

现在，Agent 调用 Jenkins MCP Tool，工具返回了 10,000 个 Token 的日志。

下一次模型调用可能需要处理之前的上下文以及这些新日志，具体取决于 Agent
的编排方式和上下文管理策略。

这会带来两个问题：

1.  重复的 Prefill 计算。
2.  更长的 Time To First Token。

### 7.1 KV Cache 与 Prompt Caching 不一样

这两个概念很容易混淆。

  --------------------------------------------------------------------------
  特性                    KV Cache                   Prompt Caching
  ----------------------- -------------------------- -----------------------
  主要用途                避免重复计算历史 Token 的  复用符合条件的 Prompt
                          K/V                        前缀计算

  典型范围                一次推理过程中的连续生成   可能跨请求或会话

  管理方式                推理引擎内部               Provider 或推理服务实现

  主要收益                提高 Decode 效率           减少重复 Prefill 工作

  是否通用                由模型推理架构支持         依赖服务商实现及规则
  --------------------------------------------------------------------------

Prompt Caching 通常要求请求具有匹配的 Prompt 前缀，并且可能有最小 Token
数量、缓存有效期等限制。

因此，Agent 设计时需要同时考虑这两种缓存机制。

### 7.2 Agent 的优化建议

对于 MCP、DevOps Agent 和 Coding Agent，可以考虑：

1.  **缓存稳定的 System Prompt 和工具定义**：尽量保持可缓存前缀稳定。
2.  **避免重复发送不必要的历史记录**：对历史对话进行摘要，而不是无限增长上下文。
3.  **控制 MCP Tool 返回内容**：例如 Jenkins
    日志只返回错误上下文、关键堆栈和必要片段。
4.  **使用小模型处理简单任务**：分类、路由、格式转换不一定需要大型推理模型。
5.  **复杂任务再使用高性能模型**：把昂贵的推理资源留给真正需要它的步骤。
6.  **使用结构化输出**：避免冗长、重复的自然语言结果。
7.  **合理管理上下文窗口**：不要把整个代码库或所有历史日志都塞进每次请求。

------------------------------------------------------------------------

## 8. 完整推理生命周期总结

``` text
                 用户输入
                    |
                    v
              Tokenization
                    |
                    v
                Embedding
                    |
                    v
        +-------------------------+
        |        PREFILL          |
        |                         |
        |  处理完整输入序列        |
        |  执行 Transformer Layers |
        |  计算并保存 K/V          |
        +-------------------------+
                    |
                    v
             第一个输出 Token
                    |
                    v
        +-------------------------+
        |         DECODE          |
        |                         |
        |  输入一个新 Token        |
        |  读取历史 KV Cache       |
        |  计算新的 K/V            |
        |  预测下一个 Token        |
        +-------------------------+
                    |
                    v
              下一个 Token
                    |
                    v
               重复 Decode
                    |
                    v
                生成结束
```

### 三个最重要的结论

1.  **第一个输出 Token 比较耗时**：因为模型必须先处理整个输入序列。
2.  **后续 Token 可以复用 KV Cache**：但仍然需要执行 Transformer
    计算，并对历史上下文进行 Attention。
3.  **Prefill 和 Decode 的硬件瓶颈不同**：这解释了为什么 AI
    服务商会分别关注输入和输出 Token 的性能及价格。

理解这三个概念，就具备了进一步研究以下技术的基础：

-   LLM Inference Optimization
-   KV Cache Management
-   Continuous Batching
-   PagedAttention
-   Speculative Decoding
-   Prefix / Prompt Caching
-   GPU Memory Bandwidth Optimization

------------------------------------------------------------------------

## 术语表

  术语                    中文解释
  ----------------------- --------------------------------------------
  Token                   模型处理文本的基本单位
  Tokenization            将文本转换为 Token 的过程
  Embedding               将 Token 映射为数值向量
  Transformer             现代 LLM 的核心网络架构
  Self-Attention          自注意力机制
  Causal Attention        因果注意力，只允许关注当前位置及之前的位置
  Q / Query               查询向量
  K / Key                 键向量
  V / Value               值向量
  Logits                  Softmax 之前的候选 Token 分数
  Softmax                 将分数转换为概率分布
  Prefill                 输入预填充阶段
  Decode                  自回归输出生成阶段
  KV Cache                缓存历史 Token 的 Key 和 Value 表示
  TTFT                    首 Token 延迟
  TPS                     每秒生成 Token 数
  Prompt Caching          提示词前缀缓存
  Autoregressive          自回归，后续 Token 依赖此前 Token
  Vocabulary Projection   将隐藏状态映射到词表分数空间
