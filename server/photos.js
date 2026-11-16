// 假数据源：相当于后端的图片表。
// 这里**没有** thumbhash —— 由接口在响应时按真实图片字节算出来（见 vite.config.js）。
export const photos = [
  {
    id: '1015',
    key: 'banner',
    title: '头图',
    width: 1200,
    height: 675,
    radius: 6,
    alt: '头图示例',
  },
  {
    id: '1031',
    key: 'card',
    title: '商品图',
    width: 800,
    height: 600,
    radius: 6,
    alt: '商品图示例',
  },
  {
    id: '1032',
    key: 'avatar',
    title: '头像',
    width: 400,
    height: 400,
    radius: 999,
    alt: '头像示例',
  },
]
