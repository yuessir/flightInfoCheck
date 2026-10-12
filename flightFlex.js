/**
 * LINE Flight Flex Message 卡片產生器
 * 接收航班動態物件，回傳標準 LINE Flex Message 結構
 */
module.exports = (flight) => {
  const isArrived = flight.status && flight.status.includes('抵達');
  const isDelayed = flight.status && (flight.status.includes('延誤') || flight.status.includes('延遲'));
  const statusColor = isDelayed ? '#ef4444' : (isArrived ? '#00b900' : '#0f294d');

  // 防禦性處理長狀態字串 (Badge 專供短標籤，超過 5 字安全截斷，完整文字保留於副標題)
  const rawStatus = (flight.status || '已更新').trim();
  const badgeStatus = rawStatus.length > 5 ? rawStatus.slice(0, 4) + '…' : rawStatus;
  const statusSubtitle = flight.statusContent || (rawStatus.length > 5 ? rawStatus : '即時航班動態更新');

  return {
    type: 'flex',
    altText: `✈️ 航班動態通知：${flight.flightNo} (${flight.status || '最新動態'})`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'horizontal',
        alignItems: 'center',
        paddingBottom: '0px',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: `${flight.airlineName ? flight.airlineName + ' ' : ''}${flight.flightNo}`,
                weight: 'bold',
                size: 'xl',
                color: '#111111'
              },
              {
                type: 'text',
                text: statusSubtitle,
                size: 'xs',
                color: '#888888',
                wrap: true,
                margin: 'xs'
              }
            ],
            flex: 3
          },
          {
            type: 'box',
            layout: 'vertical',
            flex: 0,
            contents: [
              {
                type: 'text',
                text: badgeStatus,
                weight: 'bold',
                size: 'xs',
                color: '#ffffff',
                align: 'center',
                wrap: false
              }
            ],
            backgroundColor: statusColor,
            cornerRadius: '14px',
            paddingTop: '5px',
            paddingBottom: '5px',
            paddingStart: '10px',
            paddingEnd: '10px',
            alignItems: 'center'
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          {
            type: 'separator',
            margin: 'md'
          },
          // 航線起訖
          {
            type: 'box',
            layout: 'horizontal',
            justifyContent: 'space-between',
            alignItems: 'center',
            margin: 'lg',
            contents: [
              // 出發
              {
                type: 'box',
                layout: 'vertical',
                alignItems: 'flex-start',
                flex: 4,
                contents: [
                  {
                    type: 'text',
                    text: flight.departInfo?.actualTime || flight.departInfo?.plannedTime || '--:--',
                    size: 'xxl',
                    weight: 'bold',
                    color: '#0f294d'
                  },
                  {
                    type: 'text',
                    text: `表定 ${flight.departInfo?.plannedTime || '--:--'}`,
                    size: 'xxs',
                    color: '#999999'
                  },
                  {
                    type: 'text',
                    text: `${flight.departInfo?.airport || '出發地'} ${flight.departInfo?.terminal ? flight.departInfo.terminal + '航廈' : ''}`,
                    size: 'xs',
                    color: '#555555',
                    weight: 'bold',
                    wrap: true,
                    margin: 'xs'
                  }
                ]
              },
              // 飛機圖示
              {
                type: 'box',
                layout: 'vertical',
                alignItems: 'center',
                flex: 2,
                contents: [
                  {
                    type: 'text',
                    text: '✈️',
                    size: 'lg'
                  },
                  {
                    type: 'text',
                    text: '———',
                    size: 'xxs',
                    color: '#cccccc'
                  }
                ]
              },
              // 抵達
              {
                type: 'box',
                layout: 'vertical',
                alignItems: 'flex-end',
                flex: 4,
                contents: [
                  {
                    type: 'text',
                    text: flight.arrivalInfo?.actualTime || flight.arrivalInfo?.plannedTime || '--:--',
                    size: 'xxl',
                    weight: 'bold',
                    color: '#0f294d',
                    align: 'end'
                  },
                  {
                    type: 'text',
                    text: `表定 ${flight.arrivalInfo?.plannedTime || '--:--'}`,
                    size: 'xxs',
                    color: '#999999',
                    align: 'end'
                  },
                  {
                    type: 'text',
                    text: `${flight.arrivalInfo?.airport || '目的地'} ${flight.arrivalInfo?.terminal ? flight.arrivalInfo.terminal + '航廈' : ''}`,
                    size: 'xs',
                    color: '#555555',
                    weight: 'bold',
                    wrap: true,
                    margin: 'xs',
                    align: 'end'
                  }
                ]
              }
            ]
          },
          // 重點資訊卡片 (辦理登機 / 登機門 / 行李轉盤)
          {
            type: 'box',
            layout: 'horizontal',
            spacing: 'sm',
            margin: 'xl',
            contents: [
              // 辦理登機
              {
                type: 'box',
                layout: 'vertical',
                backgroundColor: '#f5f7fa',
                cornerRadius: '8px',
                paddingAll: '8px',
                alignItems: 'center',
                flex: 1,
                contents: [
                  {
                    type: 'text',
                    text: '辦理登機',
                    size: 'xxs',
                    color: '#666666'
                  },
                  {
                    type: 'text',
                    text: flight.checkIn?.value || '-',
                    size: 'lg',
                    weight: 'bold',
                    color: '#0f294d',
                    margin: 'xs'
                  },
                  {
                    type: 'text',
                    text: flight.checkIn?.secondary || '報到櫃台',
                    size: 'xxs',
                    color: '#888888',
                    wrap: true,
                    align: 'center',
                    margin: 'xxs'
                  }
                ]
              },
              // 登機門
              {
                type: 'box',
                layout: 'vertical',
                backgroundColor: '#f5f7fa',
                cornerRadius: '8px',
                paddingAll: '8px',
                alignItems: 'center',
                flex: 1,
                contents: [
                  {
                    type: 'text',
                    text: '登機門',
                    size: 'xxs',
                    color: '#666666'
                  },
                  {
                    type: 'text',
                    text: flight.gate?.value || '-',
                    size: 'lg',
                    weight: 'bold',
                    color: '#0f294d',
                    margin: 'xs'
                  },
                  {
                    type: 'text',
                    text: 'Gate',
                    size: 'xxs',
                    color: '#888888',
                    margin: 'xxs'
                  }
                ]
              },
              // 行李轉盤
              {
                type: 'box',
                layout: 'vertical',
                backgroundColor: '#f5f7fa',
                cornerRadius: '8px',
                paddingAll: '8px',
                alignItems: 'center',
                flex: 1,
                contents: [
                  {
                    type: 'text',
                    text: '行李轉盤',
                    size: 'xxs',
                    color: '#666666'
                  },
                  {
                    type: 'text',
                    text: flight.baggage?.value || '-',
                    size: 'lg',
                    weight: 'bold',
                    color: '#0f294d',
                    margin: 'xs'
                  },
                  {
                    type: 'text',
                    text: 'Carousel',
                    size: 'xxs',
                    color: '#888888',
                    margin: 'xxs'
                  }
                ]
              }
            ]
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: 'ℹ️ 僅供參考，資料來源：Trip.com (VariFlight)',
            size: 'xxs',
            color: '#aaaaaa',
            align: 'center'
          }
        ],
        paddingTop: '0px'
      }
    }
  };
};
