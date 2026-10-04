
    /* ──────────────── 「模型」标签页：自动换源的等级与层级 ──────────────── */

    /** 等级下拉的选项：未分级 + 1/2/3（**1 = 最强/最贵**）。 */
    const MODEL_TIER_CHOICES = [
      ['', '未分级（末位候补）'],
      ['1', '1 级 · 最强'],
      ['2', '2 级'],
      ['3', '3 级 · 最弱'],
    ]

    /**
     * 当前生效的提供方顺序：表单里排过的按它的次序，没排过的接在后面（保持 host 给的目录顺序）。
     *
     * 为什么不直接复用 host 的 `orderProviders`：两端是各自独立的 bundle（host 是 ESM、
     * 客户端是手写 IIFE），没有共享模块的口子；这里只需要「按名单排序」这一件事。
     *
     * @param providers - host 给的提供方（已按当前策略排过一遍）。
     * @param listed - 表单里的 `providerOrder`。
     * @returns 提供方 id 的顺序。
     */
    function orderProviderIds(providers, listed) {
      const rank = new Map()
      const order = Array.isArray(listed) ? listed : []
      order.forEach((id, index) => rank.set(id, index))
      let next = order.length
      for (const provider of providers) {
        if (rank.has(provider.id)) continue
        rank.set(provider.id, next)
        next += 1
      }
      return providers.map((provider) => provider.id).sort((left, right) => (rank.get(left) ?? 0) - (rank.get(right) ?? 0))
    }

    /**
     * 模型页：自动换源的总开关、每个模型的等级与屏蔽项、提供方的层级顺序。
     *
     * 这一页存在的理由就是那条换源纪律，所以它写在页面上而不是只写在代码里：
     * **同级优先 → 没有同级降一级 → 未分级的排最后**，且**只能向下换**（失败提供方下面的
     * 那些提供方才会被选中），同提供方不选（余额不足是提供方/账号级的）。
     *
     * @param props - `{ state, act, busy, error }`（与其他标签页一致）。
     * @returns 模型页。
     */
    function ModelTierTab({ state, act, busy, error }) {
      const models = state.models ?? {}
      const providers = Array.isArray(models.providers) ? models.providers : []
      const baseline = {
        autoSwitch: models.autoSwitch !== false,
        tiers: { ...(models.tiers ?? {}) },
        blocked: [...(models.blocked ?? [])],
        providerOrder: [...(models.providerOrder ?? [])],
      }
      const [form, setForm] = useState(() => JSON.parse(JSON.stringify(baseline)))
      const [dirty, setDirty] = useState(false)

      const patch = (values) => {
        setForm((previous) => ({ ...previous, ...values }))
        setDirty(true)
      }

      const save = async () => {
        const { ok } = await act.run({ section: 'model', op: 'save', models: form })
        if (ok) {
          setDirty(false)
          act.flash({ tone: 'ok', text: '自动换源策略已保存。' })
        }
      }

      const reset = () => {
        setForm(JSON.parse(JSON.stringify(baseline)))
        setDirty(false)
      }

      const order = orderProviderIds(providers, form.providerOrder)

      const move = (id, delta) => {
        const next = [...order]
        const from = next.indexOf(id)
        const to = from + delta
        if (from < 0 || to < 0 || to >= next.length) return
        const [item] = next.splice(from, 1)
        next.splice(to, 0, item)
        patch({ providerOrder: next })
      }

      const setTier = (key, value) => {
        const tiers = { ...form.tiers }
        if (value === '') delete tiers[key]
        else tiers[key] = Number(value)
        patch({ tiers })
      }

      const toggleBlocked = (key) =>
        patch({
          blocked: form.blocked.includes(key) ? form.blocked.filter((item) => item !== key) : [...form.blocked, key],
        })

      return h(
        'div',
        { className: 'dcc-layout' },
        h(
          'div',
          { className: 'dcc-bar' },
          h(
            'span',
            { className: 'dcc-grow' },
            h(
              'span',
              { className: 'dcc-desc' },
              '余额不足时换到别的提供方：**同级优先 → 没有同级降一级 → 未分级的排最后**；只能**向下**换（失败提供方下面的提供方才会被选中），只改当前这条会话。',
            ),
          ),
          h(Button, { variant: 'outline', disabled: !dirty, onClick: reset }, '撤销改动'),
          h(Button, { variant: 'primary', disabled: busy || !dirty, onClick: save }, '保存'),
        ),
        h(ErrorLine, { text: error }),
        h(
          'div',
          { className: 'dcc-switchrow' },
          h(
            'div',
            { className: 'dcc-col' },
            h('div', { className: 'dcc-name' }, '自动换模型'),
            h('div', { className: 'dcc-hint' }, '关掉之后余额不足只会在对话里报错，不会自动切提供方，也不会代发「继续」。'),
          ),
          h(Toggle, { checked: form.autoSwitch, onChange: (value) => patch({ autoSwitch: value }), label: '' }),
        ),
        models.available === false
          ? h(
              'div',
              { className: 'dcc-hint' },
              `平台没有给出模型目录（${models.error ?? 'sessionController 未挂载'}）：策略仍可保存，但这里列不出可选的模型。`,
            )
          : null,
        h('div', { className: 'dcc-secttitle' }, '提供方层级（顺序即层级：越靠上越优先；换源只能向下）'),
        h(
          'div',
          { className: 'dcc-list' },
          order.length === 0 ? h(Empty, { text: '还没有可配置的模型：等平台给出目录后再来这一页。' }) : null,
          ...order.map((id, index) => {
            const provider = providers.find((item) => item.id === id) ?? { id, name: id, models: [] }
            return h(
              Card,
              {
                key: `provider:${id}`,
                title: `${index + 1}. ${provider.name ?? id}`,
                badges: [h(Badge, { key: 'id' }, id)],
                desc: '这个提供方下面的那些，才是它余额不足时会被换到的目标。',
                actions: h(
                  'div',
                  { className: 'dcc-rowacts' },
                  h(Button, { variant: 'ghost', size: 'sm', disabled: index === 0, onClick: () => move(id, -1) }, '上移'),
                  h(
                    Button,
                    { variant: 'ghost', size: 'sm', disabled: index === order.length - 1, onClick: () => move(id, 1) },
                    '下移',
                  ),
                ),
              },
              provider.models.length === 0
                ? h('div', { className: 'dcc-hint' }, '目录里没有这个提供方的模型。')
                : h(
                    'div',
                    { className: 'dcc-modellist' },
                    ...provider.models.map((model) => {
                      const key = `${id}/${model.id}`
                      return h(
                        'div',
                        { className: 'dcc-modelrow', key },
                        h('span', { className: 'dcc-modelname', title: key }, model.name ?? model.id),
                        h(
                          'select',
                          {
                            className: 'dcc-tierpick',
                            value: form.tiers[key] === undefined ? '' : String(form.tiers[key]),
                            onChange: (event) => setTier(key, event.target.value),
                          },
                          ...MODEL_TIER_CHOICES.map(([value, label]) => h('option', { key: value, value }, label)),
                        ),
                        h(
                          'label',
                          { className: 'dcc-modelblock' },
                          h('input', {
                            type: 'checkbox',
                            checked: form.blocked.includes(key),
                            onChange: () => toggleBlocked(key),
                          }),
                          '不自动切换',
                        ),
                      )
                    }),
                  ),
            )
          }),
        ),
      )
    }
