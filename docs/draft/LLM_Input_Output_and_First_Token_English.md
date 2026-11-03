# How AI Models Process Input and Generate Output: Why the First Output Token Matters

To understand how an AI model processes input and generates output, it
helps to look at the Transformer architecture. Most modern large
language models (LLMs), including GPT, Claude, GLM, MiniMax, and
DeepSeek, use the Transformer architecture or a variant of it.

The most important concept is:

**Generating the first output token is fundamentally different from
generating the second, third, and subsequent tokens.**

Before the first output token can be generated, the model must process
the entire input prompt. Starting with the second output token, the
model can usually reuse much of the previous computation through the
**KV cache (Key-Value cache)**.

This article walks through the inference process step by step.

------------------------------------------------------------------------

## 1. The Overall Inference Pipeline

Suppose the user sends this prompt:

> What is 2 + 3? Explain briefly.

The model does not process the string directly as ordinary text. It
first converts the text into tokens, maps those tokens to vectors, and
then uses the Transformer network to predict the next token.

``` text
User input text
      |
      v
Tokenization
      |
      v
Token IDs
      |
      v
Embedding + Positional Information
      |
      v
Transformer Layers
(Prefill: process the complete input)
      |
      v
Logits / Probability Distribution
(calculate scores and probabilities for the next token)
      |
      v
Select the first output token
      |
      v
Decode (generate subsequent tokens one by one)
```

The process has two core phases:

-   **Prefill:** Process the input prompt and prepare the model for
    generation.
-   **Decode:** Generate output tokens one at a time.

The first output token cannot be generated until prefill has completed.
Consequently, its latency is strongly affected by the input length.

------------------------------------------------------------------------

## 2. The Prefill Phase: How the Model Processes Input

Assume the prompt is tokenized into the following six tokens:

``` text
Token 1: What
Token 2: is
Token 3: 2
Token 4: +
Token 5: 3
Token 6: ?
```

Actual tokenization depends on the model's tokenizer and does not
necessarily align with word boundaries. This example is only for
illustration.

### 2.1 Convert Token IDs into Vectors

Each token ID is mapped to a high-dimensional numerical vector through
an embedding layer.

For simplicity, imagine that each token has a vector with only four
dimensions:

  Token   Example embedding
  ------- ------------------------
  What    `[0.2, 0.5, 0.1, 0.8]`
  is      `[0.3, 0.1, 0.7, 0.4]`
  2       `[0.9, 0.2, 0.3, 0.1]`
  \+      `[0.1, 0.8, 0.2, 0.5]`
  3       `[0.7, 0.3, 0.4, 0.2]`
  ?       `[0.4, 0.6, 0.1, 0.9]`

Real models use much larger embedding dimensions, often numbering in the
thousands.

The model also incorporates positional information so that it can
distinguish:

-   `A B` from `B A`.
-   Earlier tokens from later tokens.
-   Relationships between tokens at different positions.

A common positional encoding technique in modern Transformers is **RoPE
(Rotary Positional Embeddings)**.

### 2.2 Process the Sequence Through Transformer Layers

This is where most of the model's computation takes place.

A typical Transformer layer has two major components:

1.  **Self-attention**
2.  **Feed-Forward Network (FFN)**

These components are repeated across multiple Transformer layers.

#### Self-attention: Understanding Context

Self-attention allows each token to incorporate information from
preceding tokens.

For example, under causal attention:

  Current token   Tokens it can attend to
  --------------- ---------------------------
  What            What
  is              What, is
  2               What, is, 2
  \+              What, is, 2, +
  3               What, is, 2, +, 3
  ?               The entire input sequence

This restriction is implemented using a **causal mask**, which prevents
the model from seeing future tokens when predicting a token at a
particular position.

**An easily overlooked detail: multiple input positions can be processed
in parallel during prefill.**

Although each position has a different attention context, the GPU can
calculate the positions in parallel. The model does not have to advance
through the input one token at a time, as it does during autoregressive
output generation.

### 2.3 What Are Q, K, and V?

Inside the attention mechanism, the model derives three representations
from its hidden states:

-   **Q (Query):** What information is this token looking for?
-   **K (Key):** What information does each token advertise or make
    available for matching?
-   **V (Value):** What information should actually be retrieved from
    each token?

A common attention equation is:

\[
Attention(Q,K,V)=Softmax`\left`{=tex}(`\frac{QK^T}{\sqrt{d_k}}`{=tex}`\right`{=tex})V
\]

A simplified interpretation:

1.  Compare the Query with the Keys to calculate relevance scores.
2.  Apply Softmax to obtain attention weights.
3.  Use those weights to calculate a weighted sum of the Values.
4.  Produce a representation enriched with contextual information.

### 2.4 Where Does the KV Cache Come From?

Within each Transformer attention layer, the model calculates Key and
Value representations for the input tokens.

These K/V representations can be stored for later use during generation.
This is the **KV cache**.

For example, if the input contains six tokens:

``` text
What is 2 + 3 ?
```

After prefill, the model has calculated the K/V representations required
for those input positions across its attention layers.

When new tokens are generated, the model does not need to recalculate
the historical tokens' K/V representations.

The KV cache typically contains cached data for every attention layer,
rather than being one simple cache for the entire model.

------------------------------------------------------------------------

## 3. How Exactly Is the First Output Token Generated?

This is one of the most important parts of the inference process.

Assume the model has finished processing the input:

``` text
Input: What is 2 + 3?
```

The model takes the final hidden representation at the last input
position (the `?` position in this simplified example) and projects it
into the model's vocabulary space.

### 3.1 From the Hidden State to Logits

Suppose the model's vocabulary contains 100,000 candidate tokens.

The model calculates a score for each candidate token. These scores are
called **logits**.

For illustration:

  Candidate token     Example probability
  ----------------- ---------------------
  `5`                                 75%
  `The`                               10%
  `2`                                  5%
  `Answer`                             4%
  Other tokens                         6%

These probabilities are illustrative, not measurements from an actual
model.

### 3.2 Softmax: Convert Logits into Probabilities

The model commonly uses the Softmax function to convert logits into a
probability distribution:

\[ P(token_i)=`\frac{e^{z_i}}{\sum_j e^{z_j}}`{=tex} \]

Where:

-   (z_i) is the logit for a candidate token.
-   The denominator is the sum of the exponentiated scores of all
    candidate tokens.
-   The probabilities of all candidate tokens sum to 1.

### 3.3 Decoding: Select the First Token

The model selects a token according to its decoding strategy.

#### Greedy Decoding

Select the token with the highest probability.

``` text
5 = 75%
```

The first output token is therefore:

``` text
5
```

#### Sampling

Alternatively, the model can sample from the probability distribution.

For example, it might select `The` even though `5` has the highest
probability.

Parameters such as temperature, top-p, and top-k can affect sampling:

-   **Temperature:** Changes the sharpness of the probability
    distribution.
-   **Top-p:** Samples only from a candidate set whose cumulative
    probability reaches a specified threshold.
-   **Top-k:** Samples only from the K highest-probability candidate
    tokens.

The first-token generation process can therefore be summarized as:

``` text
Complete input
      |
      v
Transformer processing
      |
      v
Final input position's hidden state
      |
      v
Vocabulary projection
      |
      v
Logits
      |
      v
Softmax
      |
      v
Decoding strategy
      |
      v
First output token
```

**Why is the first token relatively expensive to generate?**

Before it appears, the model must complete the prefill computation for
the entire input, including:

1.  Token embeddings and positional encoding.
2.  Computation through all Transformer layers.
3.  Attention calculations.
4.  Calculation of the final hidden state.
5.  Vocabulary projection.
6.  Token selection.

This is why longer prompts generally increase **Time to First Token
(TTFT)**.

------------------------------------------------------------------------

## 4. How Is the Second Output Token Generated?

Assume the model has generated its first token:

``` text
Input:  What is 2 + 3?
Output: 5
```

The model now needs to continue generating something like:

``` text
The answer is 5.
```

At this point, the model does not need to process the entire original
prompt again from scratch.

Instead, it can use the KV cache:

1.  Append the newly generated token to the sequence.
2.  Convert the new token into an embedding.
3.  Pass the new token through the Transformer layers.
4.  Reuse the previously stored KV cache.
5.  Calculate the probability distribution for the next token.
6.  Select the next token.

For example:

``` text
First generation:
Input:  What is 2 + 3 ?
Output: 5

Second generation:
Existing KV cache: What is 2 + 3 ?
New input: 5
Output: The

Third generation:
Existing KV cache: What is 2 + 3 ? 5
New input: The
Output: answer
```

### 4.1 How Does the KV Cache Reduce Repeated Computation?

Assume the original input contains six tokens.

After the first generation step, the model has the KV cache for those
six input positions.

During the second generation step:

-   It does not need to recalculate K/V for the original six tokens.
-   It calculates new K/V representations for the newly generated token.
-   The new token's Query still needs to attend to the historical Keys.
-   The resulting hidden state is used to calculate the next token's
    logits.

The third generation step repeats this process.

Therefore, KV caching does not eliminate computation involving
historical context. It avoids recomputing the historical tokens' Key and
Value representations.

------------------------------------------------------------------------

## 5. Why Does the First Token Matter So Much for Performance?

We can now distinguish two important inference performance metrics.

  -----------------------------------------------------------------------
  Metric                  Full name               Meaning
  ----------------------- ----------------------- -----------------------
  TTFT                    Time to First Token     Time from the start of
                                                  a request until the
                                                  first output token
                                                  appears

  TPS                     Tokens Per Second       How quickly the model
                                                  generates output tokens
  -----------------------------------------------------------------------

Consider two prompts:

-   Prompt A: 1,000 input tokens.
-   Prompt B: 50,000 input tokens.

Assuming the same model, hardware, and other conditions, Prompt B
generally requires substantially more prefill computation. Its first
output token will therefore usually appear later.

However, once generation begins, the two prompts may have relatively
similar decoding speeds. That said, longer contexts can also slow
decoding because each new token must attend to more historical context.

### Prefill vs. Decode

  -----------------------------------------------------------------------
  Dimension               Prefill                 Decode
  ----------------------- ----------------------- -----------------------
  Processing target       Entire input sequence   One new token at a time

  Parallelism             High                    Lower, due to
                                                  autoregressive
                                                  dependency

  Main computation        Large matrix operations Single-token inference
                          and attention           and attention

  KV cache                Created or populated    Read and extended

  Performance focus       Input-token throughput  Output-token generation
                                                  speed

  Typical metric          Prefill tokens/s        Decode tokens/s
  -----------------------------------------------------------------------

This is why model providers sometimes publish two separate performance
metrics:

-   **Prefill throughput:** How quickly the model processes input
    tokens.
-   **Decode throughput:** How quickly the model generates output
    tokens.

They represent different computational workloads and can benefit from
different hardware and software optimizations.

------------------------------------------------------------------------

## 6. Why Does GPU Architecture Affect Prefill and Decode Differently?

Understanding the difference between prefill and decode also helps
explain GPU performance.

  Operation               Main performance bottleneck
  ----------------------- -----------------------------------------
  Embedding lookup        Memory access
  Prefill                 Compute throughput and memory bandwidth
  Attention               Compute capability and memory bandwidth
  KV cache access         Memory bandwidth
  Decode                  Often memory-bandwidth-bound
  Vocabulary projection   Compute and memory access

### Why Is Decode Often Memory-Bandwidth-Bound?

At each generation step, the GPU needs to access model weights and
historical attention data.

However, each step generally generates only one new token.

For large models, the GPU may need to read a substantial amount of model
data while performing a relatively small amount of new computation.
Memory bandwidth can therefore become a bottleneck.

Prefill, on the other hand, processes many input tokens together,
allowing the GPU to make more effective use of its parallel compute
units.

Consequently:

**A GPU's advertised FLOPS (floating-point operations per second) alone
cannot predict LLM inference speed.**

Other important factors include:

-   Memory capacity.
-   Memory bandwidth.
-   GPU compute capability.
-   KV cache size.
-   Attention kernel implementation.
-   Batch size and concurrent request count.
-   Model quantization.

------------------------------------------------------------------------

## 7. What Does This Mean for AI Agent Architecture?

Consider a DevOps MCP Agent with the following context:

  Component                     Token count
  --------------------------- -------------
  System prompt                      10,000
  MCP tool definitions                5,000
  Conversation history               20,000
  Current user instructions           1,000
  **Total**                      **36,000**

Before generating its first output token, the model generally needs to
process approximately 36,000 input tokens.

Now suppose the agent calls a Jenkins MCP tool, which returns 10,000
tokens of logs.

The next model invocation may need to process the previous context plus
the new logs, depending on the orchestration and context-management
strategy.

This creates two problems:

1.  Repeated prefill computation.
2.  Increased time to first token.

### 7.1 KV Cache and Prompt Caching Are Not the Same

These two concepts are easy to confuse.

  -----------------------------------------------------------------------
  Feature                 KV cache                Prompt caching
  ----------------------- ----------------------- -----------------------
  Main purpose            Avoid recomputing       Reuse eligible
                          historical tokens' K/V  prompt-prefix
                          representations         computations

  Typical scope           Continuous generation   Potentially across
                          within an inference     requests or sessions
                          sequence                

  Management              Internal to the         Implemented by the
                          inference engine        provider or inference
                                                  service

  Main benefit            Improves decode         Reduces repeated
                          efficiency              prefill work

  Availability            Supported by the        Depends on provider
                          model's inference       implementation and
                          architecture            rules
  -----------------------------------------------------------------------

Prompt caching generally requires a matching prompt prefix. Providers
may also impose requirements such as minimum token counts, cache
expiration periods, or other eligibility conditions.

Agent architectures should consider both mechanisms.

### 7.2 Optimization Recommendations for Agents

For MCP agents, DevOps agents, and coding agents, consider the
following:

1.  **Cache stable system prompts and tool definitions.** Keep cacheable
    prompt prefixes as stable as possible.
2.  **Avoid repeatedly sending unnecessary conversation history.**
    Summarize old conversations instead of allowing context to grow
    indefinitely.
3.  **Control MCP tool response sizes.** For example, return relevant
    Jenkins error context, stack traces, and necessary log excerpts
    rather than entire logs.
4.  **Use smaller models for simple tasks.** Classification, routing,
    and format conversion do not necessarily require large reasoning
    models.
5.  **Reserve powerful models for complex decisions.** Use expensive
    reasoning capacity only when the task genuinely requires it.
6.  **Use structured outputs.** Avoid verbose and repetitive
    natural-language responses.
7.  **Manage the context window carefully.** Do not include an entire
    codebase or all historical logs in every request.

------------------------------------------------------------------------

## 8. Complete Inference Lifecycle

``` text
                   User input
                       |
                       v
                  Tokenization
                       |
                       v
                    Embedding
                       |
                       v
          +---------------------------+
          |          PREFILL          |
          |                           |
          | Process the complete      |
          | input sequence            |
          |                           |
          | Execute Transformer layers|
          |                           |
          | Calculate and store K/V   |
          +---------------------------+
                       |
                       v
              First output token
                       |
                       v
          +---------------------------+
          |           DECODE          |
          |                           |
          | Input one new token       |
          | Read historical KV cache  |
          | Calculate new K/V         |
          | Predict the next token    |
          +---------------------------+
                       |
                       v
                 Next output token
                       |
                       v
                Repeat decoding
                       |
                       v
                 Generation ends
```

### Three Key Takeaways

1.  **The first output token is relatively expensive:** The model must
    process the entire input sequence before it can generate that token.
2.  **Subsequent tokens can reuse the KV cache:** They still require
    Transformer computation and attention over historical context.
3.  **Prefill and decode have different hardware bottlenecks:** This
    explains why AI providers separately measure and price input-token
    and output-token processing.

Understanding these concepts provides a foundation for exploring:

-   LLM inference optimization.
-   KV cache management.
-   Continuous batching.
-   PagedAttention.
-   Speculative decoding.
-   Prefix and prompt caching.
-   GPU memory-bandwidth optimization.

------------------------------------------------------------------------

## Glossary

  -----------------------------------------------------------------------
  Term                                Explanation
  ----------------------------------- -----------------------------------
  Token                               A basic unit of text processed by a
                                      model

  Tokenization                        The process of converting text into
                                      tokens

  Embedding                           Mapping a token to a numerical
                                      vector

  Transformer                         The core neural-network
                                      architecture used by modern LLMs

  Self-attention                      A mechanism that lets tokens
                                      incorporate contextual information

  Causal attention                    Attention that permits a token to
                                      attend only to itself and preceding
                                      tokens

  Q / Query                           Query vector

  K / Key                             Key vector

  V / Value                           Value vector

  Logits                              Scores for candidate tokens before
                                      Softmax

  Softmax                             A function that converts scores
                                      into a probability distribution

  Prefill                             The input-processing phase

  Decode                              The autoregressive
                                      output-generation phase

  KV cache                            Cached Key and Value
                                      representations of historical
                                      tokens

  TTFT                                Time to First Token

  TPS                                 Tokens Per Second

  Prompt caching                      Caching of eligible prompt-prefix
                                      computations

  Autoregressive                      A generation process in which later
                                      tokens depend on earlier tokens

  Vocabulary projection               Mapping a hidden state to scores
                                      over the model vocabulary
  -----------------------------------------------------------------------
